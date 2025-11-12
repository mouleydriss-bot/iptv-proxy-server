const express = require('express');
const cors = require('cors'); // Assurez-vous que 'cors' est installé : npm install cors
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3001; // Utilisez PORT fourni par Render

app.use(cors());

// Middleware du proxy pour /api
const iptvProxy = createProxyMiddleware({
  // La cible est déterminée dynamiquement par l'en-tête X-Target-Url
  router: (req) => {
    const targetUrl = req.get('X-Target-Url'); // Lire l'URL cible de l'en-tête
    if (!targetUrl) {
      // Si l'en-tête n'est pas fourni, renvoyer une erreur
      // Cela sera géré par le onError ou pourra causer une erreur dans le proxy
      throw new Error('Missing X-Target-Url header');
    }
    // Extraire le protocole et le host
    const parsedTarget = new URL(targetUrl);
    return `${parsedTarget.protocol}//${parsedTarget.host}`;
  },
  // Réécrire le chemin pour enlever /api du début
  pathRewrite: (path, req) => {
    const targetUrl = req.get('X-Target-Url'); // Lire l'URL cible de l'en-tête
    if (!targetUrl) {
      // Si l'en-tête n'est pas fourni, ne rien réécrire (ou gérer l'erreur)
      return path;
    }
    // Extraire le chemin et les query params de l'URL cible
    const parsedTarget = new URL(targetUrl);
    return parsedTarget.pathname + parsedTarget.search;
  },
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    // Conserver l'User-Agent original ou en définir un
    // proxyReq.setHeader('User-Agent', 'VLC/3.0.20 (Windows; x64_64)');
    // Laissez-le tel quel pour l'instant, ou adaptez selon besoin
  },
  // Gestion des erreurs de proxy
  onError: (err, req, res) => {
    console.error('Proxy Error:', err);
    res.status(500).send('Proxy Error');
  }
});

// Utiliser le proxy pour toutes les requêtes vers /api
app.use('/api', iptvProxy);

// Route de base (facultative)
app.get('/', (req, res) => {
  res.send('Proxy IPTV OK');
});

app.listen(PORT, () => {
  console.log(`Serveur proxy IPTV démarré sur port ${PORT}`);
});
