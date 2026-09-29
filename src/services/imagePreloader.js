const loadedCache = new Set();
const failedCache = new Set();
const pendingPromises = new Map();

/**
 * Preload an image URL before rendering, with no-referrer policy and timeout.
 * Returns a Promise that resolves with the image URL if successfully loaded,
 * or rejects if the image fails or times out.
 */
export function preloadImage(url, timeoutMs = 8000) {
  if (!url || typeof url !== "string" || !url.trim()) {
    return Promise.reject(new Error("Empty image URL"));
  }

  const cleanUrl = url.trim();

  // If local asset in public directory, treat as instantly available
  if (cleanUrl.startsWith("/images/")) {
    loadedCache.add(cleanUrl);
    return Promise.resolve(cleanUrl);
  }

  if (loadedCache.has(cleanUrl)) {
    return Promise.resolve(cleanUrl);
  }

  if (failedCache.has(cleanUrl)) {
    return Promise.reject(new Error(`Image previously failed to load: ${cleanUrl}`));
  }

  if (pendingPromises.has(cleanUrl)) {
    return pendingPromises.get(cleanUrl);
  }

  if (typeof window === "undefined" || typeof window.Image === "undefined") {
    // Non-browser / test environment fallback
    loadedCache.add(cleanUrl);
    return Promise.resolve(cleanUrl);
  }

  const promise = new Promise((resolve, reject) => {
    const img = new window.Image();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        pendingPromises.delete(cleanUrl);
        failedCache.add(cleanUrl);
        img.src = "";
        reject(new Error(`Timeout loading image: ${cleanUrl}`));
      }
    }, timeoutMs);

    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        pendingPromises.delete(cleanUrl);
        loadedCache.add(cleanUrl);
        resolve(cleanUrl);
      }
    };
    img.onerror = (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        pendingPromises.delete(cleanUrl);
        failedCache.add(cleanUrl);
        reject(err || new Error(`Failed to load image: ${cleanUrl}`));
      }
    };
    img.src = cleanUrl;
  });

  pendingPromises.set(cleanUrl, promise);
  return promise;
}

export function isImageLoaded(url) {
  if (!url || typeof url !== "string") return false;
  const cleanUrl = url.trim();
  if (cleanUrl.startsWith("/images/")) return true;
  return loadedCache.has(cleanUrl);
}

export function isImageFailed(url) {
  if (!url || typeof url !== "string") return true;
  return failedCache.has(url.trim());
}
