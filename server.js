// server.js (pour Vercel)
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Vercel fournit dynamiquement le port via la variable d'environnement PORT
const PORT = process.env.PORT || 3000;

// Middleware pour parser le body si nécessaire (utile pour POST)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware pour servir les fichiers statiques (facultatif, mais utile si vous en avez)
app.use(express.static('public'));

// Configuration du proxy
const xtreamProxy = createProxyMiddleware({
  // La cible sera dynamiquement définie par la requête entrante via l'en-tête X-Target-Url
  target: 'http://exemple-serveur-xtream.com:1234', // Valeur par défaut, sera écrasée
  changeOrigin: true, // Important pour le bon fonctionnement du proxy
  pathRewrite: {
    // Supprime '/api' du chemin envoyé au serveur cible
    // Ex: /api/player_api.php devient /player_api.php
    '^/api': ''
  },
  onProxyReq: (proxyReq, req, res) => {
    // Lire l'URL cible depuis l'en-tête X-Target-Url
    const targetUrl = req.get('X-Target-Url');
    if (targetUrl) {
      // Extraire le chemin de la requête proxy (sans /api)
      const proxyPath = req.url.replace('/api', '');
      // Construire l'URL complète vers le serveur Xtream cible
      const targetPath = new URL(proxyPath, targetUrl).pathname + new URL(proxyPath, targetUrl).search;
      proxyReq.path = targetPath;
      proxyReq.host = new URL(targetUrl).host;
      proxyReq.setHeader('Host', new URL(targetUrl).host);
      console.log(`Proxying to: ${targetUrl}${targetPath}`); // Log pour le débogage sur Vercel
    } else {
      // Si X-Target-Url n'est pas fourni, renvoyer une erreur
      res.status(400).send('Missing X-Target-Url header');
      return; // Arrêter le traitement de cette requête
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // Ajouter les en-têtes CORS pour que le navigateur de la TV accepte la réponse
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    proxyRes.headers['Access-Control-Allow-Headers'] = 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Target-Url';
  },
  // Gestion des erreurs de proxy
  onError: (err, req, res) => {
    console.error('Proxy Error:', err);
    res.status(500).send('Proxy Error');
  }
});

// Gestion de la route principale du proxy
app.use('/api', xtreamProxy);

// Gestion des requêtes OPTIONS (pré-vol) pour CORS
app.options('/api/*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Target-Url');
  res.sendStatus(200);
});

// Route de base (facultative, pour vérifier que le serveur est en ligne)
app.get('/', (req, res) => {
  res.send('Proxy Xtream Vercel OK');
});

// Démarrer le serveur
const server = app.listen(PORT, () => {
  console.log(`Proxy serveur démarré sur port ${PORT}`);
});

// Exporter pour Vercel (nécessaire pour les environnements serverless, mais ici on utilise un serveur classique)
module.exports = server;
