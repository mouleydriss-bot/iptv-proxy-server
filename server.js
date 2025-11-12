const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3001; // Le proxy tournera sur un port différent

app.use(cors());

// Middleware du proxy
const iptvProxy = createProxyMiddleware({
  // La cible est déterminée dynamiquement par la requête
  router: (req) => {
    const targetUrl = new URL(req.query.url);
    return `${targetUrl.protocol}//${targetUrl.host}`;
  },
  // Réécrire le chemin pour enlever le chemin du proxy
  pathRewrite: (path, req) => {
    const targetUrl = new URL(req.query.url);
    return targetUrl.pathname + targetUrl.search;
  },
  changeOrigin: true, // Essentiel pour que le serveur IPTV ne voit pas notre origine localhost
  // Injecter un User-Agent légitime
  onProxyReq: (proxyReq, req, res) => {
    proxyReq.setHeader('User-Agent', 'VLC/3.0.20 (Windows; x86_64)');
  },
});

// Utiliser le proxy pour toutes les requêtes vers /proxy
app.use('/proxy', iptvProxy);

app.listen(PORT, () => {
  console.log(`Serveur proxy IPTV démarré sur http://localhost:${PORT}`);
});