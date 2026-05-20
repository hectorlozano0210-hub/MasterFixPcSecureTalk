const DB_NAME = 'MFX_Walkie_DB';
const STORE_NAME = 'mfx_store';
const DB_VERSION = 1;

export const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject('IndexedDB error: ' + event.target.error);

    request.onsuccess = (event) => resolve(event.target.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

export const setLocalData = async (key, value) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
};

export const getLocalData = async (key) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

export const updateDailyMessageCount = async () => {
  const today = new Date().toLocaleDateString();
  const data = await getLocalData('mfx_msg_usage') || { date: today, count: 0 };
  
  if (data.date !== today) {
    data.date = today;
    data.count = 1;
  } else {
    data.count += 1;
  }
  
  await setLocalData('mfx_msg_usage', data);
  return data.count;
};

export const getDailyMessageCount = async () => {
  const today = new Date().toLocaleDateString();
  const data = await getLocalData('mfx_msg_usage') || { date: today, count: 0 };
  
  if (data.date !== today) {
    data.date = today;
    data.count = 0;
    await setLocalData('mfx_msg_usage', data);
  }
  return data.count;
};
