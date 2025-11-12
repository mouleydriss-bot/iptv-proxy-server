const express = require('express');
const cors = require('cors'); // Assurez-vous que 'cors' est installé : npm install cors
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3001; // Utilisez PORT fourni par Render

app.use(cors());

// Middleware du proxy pour /api
const iptvProxy = createProxyMiddleware({
  // La cible (host) est déterminée dynamiquement par l'en-tête X-Target-Url
  router: (req) => {
    const targetUrl = req.get('X-Target-Url'); // Lire l'URL cible de l'en-tête
    if (!targetUrl) {
      console.error('Erreur Proxy: En-tête X-Target-Url manquant');
      return null; // ou une URL d'erreur
    }
    try {
        // Extraire le protocole et le host
        const parsedTarget = new URL(targetUrl);
        const targetBase = `${parsedTarget.protocol}//${parsedTarget.host}`;
        console.log(`Proxy redirige vers: ${targetBase}`); // Log pour le débogage
        return targetBase;
    } catch (e) {
        console.error('Erreur Proxy: URL cible invalide dans X-Target-Url:', targetUrl, e);
        return null; // ou une URL d'erreur
    }
  },
  // Réécrire le chemin pour enlever /api du début
  // http-proxy-middleware monté sur /api devrait normalement le faire automatiquement,
  // mais spécifions-le explicitement pour corriger le problème.
  pathRewrite: (path, req) => {
    // 'path' est le chemin de la requête entrante (ex: /api/player_api.php?username=...&password=...&action=get_user_info)
    // On veut envoyer /player_api.php?username=...&password=...&action=get_user_info au serveur cible.
    // Donc, on remplace '/api' (en début de chaîne) par '' (rien).
    const newPath = path.replace(/^\/api/, '');
    console.log(`Proxy réécrit le chemin de "${path}" vers "${newPath}"`); // Log pour le débogage
    return newPath;
  },
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    // Conserver l'User-Agent original ou en définir un
    // proxyReq.setHeader('User-Agent', 'VLC/3.0.20 (Windows; x64_64)');
    // Laissez-le tel quel pour l'instant, ou adaptez selon besoin
    console.log(`Proxy envoie requête à: ${proxyReq.path} sur ${proxyReq.host}`); // Log pour le débogage
  },
  // Gestion des erreurs de proxy
  onError: (err, req, res) => {
    console.error('Erreur Proxy:', err);
    // Envoyer une réponse d'erreur au client
    res.status(500).send('Erreur interne du proxy');
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
