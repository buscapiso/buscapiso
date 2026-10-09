// IndexedDB sin dependencias: un almacen por tipo de dato. Lo del portal
// (listings), lo de la usuaria (userState) y lo calculado (derived) van
// separados para que importar, puntuar y editar no se pisen.
export const DB_NAME = 'buscapiso';
export const DB_VERSION = 1;
export const STORES = ['listings', 'userState', 'derived', 'profiles', 'settings', 'travelCache',
  'geoCache', 'aiCache'] as const;
export type StoreName = (typeof STORES)[number];
const KEYS: Record<StoreName, string | null> = {
  listings: 'id', userState: 'id', derived: 'id', profiles: 'name',
  settings: null, travelCache: null, geoCache: null, aiCache: null,
};

const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
const done = (t: IDBTransaction) => new Promise<void>((ok, ko) => {
  t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
});

export class Db {
  private constructor(private db: IDBDatabase) {}

  static async open(name = DB_NAME, factory: IDBFactory = indexedDB): Promise<Db> {
    const r = factory.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      for (const s of STORES) {
        if (!r.result.objectStoreNames.contains(s)) {
          const os = r.result.createObjectStore(s, KEYS[s] ? { keyPath: KEYS[s]! } : undefined);
          if (s === 'listings') os.createIndex('city', 'city');
        }
      }
    };
    return new Db(await req(r));
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return req(this.db.transaction(store).objectStore(store).get(key));
  }
  async all<T>(store: StoreName): Promise<T[]> {
    return req(this.db.transaction(store).objectStore(store).getAll());
  }
  /** [clave, valor] de un almacen con claves externas (settings). */
  async allEntries(store: StoreName): Promise<[IDBValidKey, unknown][]> {
    const os = this.db.transaction(store).objectStore(store);
    const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
    return keys.map((k, i) => [k, values[i]]);
  }
  async byCity<T>(city: string): Promise<T[]> {
    return req(this.db.transaction('listings').objectStore('listings').index('city').getAll(city));
  }
  async put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
    const t = this.db.transaction(store, 'readwrite');
    t.objectStore(store).put(value, KEYS[store] ? undefined : key);
    await done(t);
  }
  /** Varias escrituras en una transaccion. */
  async putMany(store: StoreName, values: unknown[]): Promise<void> {
    if (!values.length) return;
    const t = this.db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const v of values) os.put(v);
    await done(t);
  }
  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const t = this.db.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    await done(t);
  }
  async clearAll(): Promise<void> {
    const t = this.db.transaction([...STORES], 'readwrite');
    for (const s of STORES) t.objectStore(s).clear();
    await done(t);
  }
  async count(store: StoreName): Promise<number> {
    return req(this.db.transaction(store).objectStore(store).count());
  }
  close() { this.db.close(); }
}

/** Ajustes clave-valor, con valor por defecto. */
export async function setting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const v = await db.get<T>('settings', key);
  return v === undefined ? fallback : v;
}
