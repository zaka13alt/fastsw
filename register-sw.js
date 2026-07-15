// 
if ('serviceWorker' in navigator) {
  // 
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/v2.0.0.js', { scope: '/' })
      .then((registration) => {
        // 
        console.log('ServiceWorker registration successful!');
        console.log('Scope: ', registration.scope);
      })
      .catch((error) => {
        // 
        console.error('ServiceWorker registration failed: ', error);
      });
  });
} else {
  console.warn('Service workers are not supported in this browser.');
}
