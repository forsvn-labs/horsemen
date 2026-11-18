/* Applies the saved theme before first paint. No saved choice follows the system setting. */
(function(){try{var saved=localStorage.getItem('horsemen-theme');if(saved==='dark'||saved==='light')document.documentElement.dataset.theme=saved}catch(e){}})();
