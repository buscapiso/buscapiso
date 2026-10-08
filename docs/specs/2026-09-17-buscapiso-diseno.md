# Buscador de habitación en Barcelona: diseño

Fecha: 2026-09-17

## Problema

Encontrar habitación de alquiler en Barcelona o área metropolitana con estos
requisitos: piso solo de chicas, ~500 €/mes más gastos, sin convivir con el
propietario, visitas permitidas, y buena conexión con Fira (L9 Sud, trabajo) y
Collblanc. Entrada inmediata.

## Decisiones y por qué

### El motor es Playwright con ventana visible

Comprobado contra el sitio real: con `headless=True`, Idealista (DataDome)
devuelve `geo.captcha-delivery.com` en lugar de anuncios. Mismo perfil, misma
IP, mismas cookies; la única variable era el modo headless. Por eso
`headless=False` está fijado en el código y no es configurable: una opción que
rompe el programa al activarla no es una opción.

### Recuperación ante bloqueo en tres escalones

Observado empíricamente: tras una ráfaga de peticiones, DataDome marca la
cookie del perfil, y a partir de ahí esperar no sirve: la marca viaja en
cada petición. Borrar el perfil sí funciona, de inmediato. De ahí la escalera:

1. reintentar,
2. tirar el perfil quemado y empezar con identidad limpia,
3. pedir ayuda humana con el captcha (90 s con la ventana abierta).

Es un backoff exponencial, pero sobre la identidad en lugar de sobre el tiempo.

### Filtrado en dos niveles, porque el del portal miente

El filtro `sexo_chica` de Idealista significa **"admite chicas"**, no "solo
chicas": en la muestra real, 27 de 30 resultados eran pisos mixtos. El filtro
de URL se usa igualmente (reduce ruido y es gratis), pero el requisito estricto
se aplica en local sobre `genero_piso`, leído del icono de cada tarjeta.

### "Se permiten visitas" no existe en Idealista

Comprobado en la ficha real: las "Normas de la casa" de Idealista son fumar,
parejas, mascotas y menores de edad. **No hay campo de visitas.** Lo más cercano
que ofrece el portal son dos señales, y ambas se usan como tales:

- `No se admiten parejas`, una norma explícita que correlaciona con reglas
  estrictas sobre quién entra en casa;
- `Ambiente de la casa: ... no suelen tener visitas y abunda el silencio`, texto
  libre que describe una **costumbre**, no una norma.

La distinción importa: un hábito resta puntos, una norma descarta. Meter la
costumbre en `visitas_permitidas` haría que un filtro estricto tirase pisos que
no prohíben nada.

### El inclusivo rompe las expresiones regulares

`El propietario/a no vive en la casa` no casa con `propietari\w+\s+no\s+vive`,
porque `\w+` no cruza la barra. El mismo problema aparece en `compañeros/as` y
`chicos/as`. Las expresiones del parser lo contemplan explícitamente. Es el
argumento práctico a favor de escribir las regex contra HTML real guardado en
lugar de contra el texto que uno imagina.

### La ficha da más de lo previsto

Además de propietario y normas, trae edad real de las compañeras
(`Entre 28 y 32 años`), ocupación (`Estudian/Trabajan`), estancia mínima y fecha
de disponibilidad. La edad real sustituye con ventaja al heurístico de buscar
"joven" o "estudiante" en el texto libre, y la fecha de disponibilidad pesa en
la puntuación porque la entrada es inmediata.

### Rutas propias en vez de una API de mapas

El ranking necesita **ordenar** bien, no cronometrar. Un grafo de 116
estaciones (L1, L2, L3, L5, L8, L9 Sud, L10 Sud) con tiempos medios por salto,
espera = frecuencia/2 y penalización de transbordo da un error de unos ±4 min,
menos que la varianza real del metro, y sin depender de ninguna clave de API.

La topología (orden de estaciones) está escrita a mano: es estable durante años
y un error se detecta con un test. La geometría (coordenadas) viene de
OpenStreetMap: son 116 pares que de memoria tendrían errores de cientos de
metros, y 300 m son 4 minutos andando. El *join* es por nombre y falla
ruidosamente si un nombre no casa.

### Geocodificación con caché

Las páginas de listado no traen coordenadas, así que hay que geocodificar la
dirección del título con Nominatim, que permite 1 petición/segundo. La caché en
SQLite no es una optimización: es lo que hace viable relanzar la búsqueda.

`coords_aproximadas` distingue acierto a nivel de calle de estimación por
centroide de barrio, y el ranking penaliza lo segundo. Un piso no debe adelantar
a otro por un tiempo de trayecto que en realidad no conocemos.

### Puntuación explicable

Ningún número sin motivo. Cada anuncio sale con su desglose
(`12 min a Fira (-4) · 450 € + 60 € gastos = 510 €/mes (-1) · publicado 16 sep
(+25)`), para poder discutirle el criterio a la herramienta.

El coste que manda es **habitación + gastos**: 490 € con 200 € de gastos es más
caro que 550 € con todo incluido. La ausencia de la línea de gastos se modela
como `None` (no declarado), nunca como 0 (incluidos).

## Arquitectura

```
buscar.py          CLI: buscar / marcar / estados
config.yaml        requisitos, pesos, municipios
zonas.yaml         exclusión, penalización y preferencia por zona (lo rellenas tú)
modelo.py          Anuncio: esquema normalizado
fuentes/base.py    interfaz Fuente
fuentes/idealista.py  URL + parser + navegador          (funciona)
fuentes/badi.py       API interna                       (experimental, sin verificar)
transporte.py      grafo de la red + Dijkstra
geocodificador.py  Nominatim con caché en SQLite
ranking.py         filtros duros + puntuación explicable
almacen.py         SQLite: histórico, novedades, estado
informe.py         HTML autocontenido
datos/build_red.py construye red.json desde OSM
```

La frontera relevante es `fuentes/base.py`: cada portal devuelve `Anuncio`
normalizados y nada más del sistema sabe qué portales existen. Añadir Fotocasa
o Habitaclia es un fichero nuevo y cero cambios en el resto.

### Una sola instancia de Playwright para todas las fuentes

La API síncrona de Playwright admite **una instancia viva por hilo**: monta su
propio bucle asyncio por dentro. Cuando cada fuente llamaba a
`sync_playwright().start()`, la primera funcionaba y las demás morían con
*"Sync API inside the asyncio loop"*. Cada clase estaba bien aislada por
separado, y precisamente por eso las tres competían por el mismo recurso global
sin saberlo.

`navegador.py` hace ese recurso explícito: una instancia compartida, un perfil
de navegador distinto por portal (para que un bloqueo en uno no contamine a los
otros), y `cerrar_todo()` al terminar.

### Deduplicación entre portales

Criterio deliberadamente estrecho: mismo precio (±10 €) y a menos de 150 m, y
solo entre portales distintos. Sin coordenadas no se afirma nada, porque en Barcelona
hay cientos de habitaciones a 500 €. Fusionar de más esconde anuncios que son
distintos de verdad, y eso no se detecta mirando el informe.

Gana el anuncio con más campos rellenos; el otro aporta lo que le falte y queda
anotado en `tambien_en`. El género confirmado siempre se impone al inferido.

### Género: dato contra inferencia

Solo Idealista y Roomgo publican el género del piso. En De Piso en Piso hay que
leerlo del texto libre, y `genero_confirmado` distingue una cosa de la otra en
el informe. Dos detalles que solo aparecen al mirar texto real:

- **El catalán.** `Busquem només 3 Noies estudiants`. Una heurística que solo
  cubra el castellano se pierde media Barcelona sin avisar.
- **`noies` y `nois`** se diferencian en una letra y significan lo contrario.
  El patrón usa `noi[ae]s?`, que deja fuera `nois`, con un test que lo fija.

### Fotocasa entrega los datos en JSON, no en HTML

La página manda los anuncios en un blob JSON incrustado y los renderiza después
con JavaScript. El parser lo localiza por la clave `realEstates` contando
corchetes y respetando cadenas y escapes, porque el blob mide cientos de miles
de caracteres y una expresión regular no sabe dónde termina.

Se busca por la clave de datos y no por el nombre de la variable de JavaScript
que la contiene, porque el framework renombra la variable en cada despliegue y
la clave de datos permanece.

El JSON trae `accuracy: false`, que significa posición del barrio y no del
portal. El parser lo traslada a `coords_aproximadas`, de modo que estos
anuncios no adelantan a los que sí tienen dirección exacta.

### Las zonas se derivan del límite de tiempo

`--max-minutos` relajaba el filtro de aceptación sin visitar ninguna zona nueva,
así que prometía una amplitud que la búsqueda no tenía: once zonas dentro del
límite, el Eixample y Gràcia entre ellas, no se miraban nunca.

`cobertura.py` calcula el tiempo desde el centroide de cada zona del catálogo y
selecciona las que entran, con un margen de 10 minutos porque un distrito mide
kilómetros y su parte más cercana puede estar bastante mejor comunicada que su
centro. Nunca devuelve una lista vacía: con un límite absurdo conserva la zona
más cercana, porque una búsqueda que no mira nada y no lo explica es peor que
una búsqueda estrecha.

Los centroides salen de Nominatim, acotado a la conurbación. Sin acotar,
"Eixample" resolvía a 41.4882 (cerca de Mollet, a 15 km) y el distrito quedaba
excluido en silencio por caer fuera del límite de tiempo. La primera caja
delimitadora era tan generosa que daba ese punto por bueno; el límite norte está
ahora en 41.47, justo por encima de Santa Coloma, que es lo más al norte que
interesa.

### Tres categorías, no dos

Fotocasa y De Piso en Piso no publican el género del piso. Descartar esos
anuncios tira opciones buenas por falta de un dato que se resuelve preguntando;
mezclarlos con los confirmados contamina la lista. Van a una tercera lista,
`posibles`, con su propia sección en el informe y un listón de puntuación.

Un piso que se sabe mixto nunca entra ahí: eso es un no definitivo, y preguntar
no lo cambia.

### Un fallo a mitad no borra lo ya recogido

La ventana de Chromium murió durante un rastreo y la excepción se propagó fuera
de `buscar()`, llevándose 79 anuncios de idealista ya descargados. El informe
salió sin un solo anuncio de ese portal mientras el log mostraba tres páginas
rastreadas con éxito.

Las cuatro fuentes devuelven ahora lo acumulado pase lo que pase. Se distingue
el error puntual, que deja seguir con las demás zonas, del navegador muerto, que
no deja nada que reintentar. Y `abrir()` levanta una ventana nueva y reintenta
una vez cuando detecta que la anterior se cerró: la ventana es visible por
obligación, así que cerrarla a mano o una caída de Chromium son accidentes
esperables.

### El género se infiere del texto y el texto engaña

Un anuncio real entró en el informe como piso de chicas diciendo:

> "Buscamos compañero/a de piso... Somos 2 chicas y 1 chico"

`somos \d* chicas` es correcto aislado y equivocado en contexto, porque acierta
en la subcadena y falla en la frase. La defensa no está en afinar el patrón
positivo sino en comprobar el negativo primero: si el texto nombra los dos
géneros, el piso es mixto, por muchos patrones de "chicas" que encaje después.

## Alcance excluido

Sin cron ni notificaciones, sin contacto automático, sin mapa interactivo, sin
Fotocasa ni Habitaclia (las URL de su sección de habitaciones no se llegaron a
verificar) ni Milanuncios. Badi queda implementado pero desactivado: su API
responde 401 y exige cuenta.

## Riesgos conocidos

- Idealista puede volver a bloquear; la recuperación está automatizada pero
  puede acabar pidiendo un captcha manual.
- Los selectores del parser se romperán tarde o temprano. Los tests corren
  contra un fixture de HTML real, así que la rotura sale como test rojo
  concreto en lugar de como lista vacía silenciosa.
- La geocodificación por nombre de calle falla en direcciones ambiguas; esos
  anuncios caen a centroide de barrio y quedan marcados como estimados.
