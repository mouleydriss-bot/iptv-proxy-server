require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3001;

// ========== CONFIGURATION SÉCURITÉ ==========
const isProduction = process.env.NODE_ENV === 'production';

// 🔒 Rate limiting pour prévenir les abus
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limites par IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de requêtes, merci de réessayer plus tard'
});

// 🔒 Configuration CORS sécurisée
const corsOptions = {
  origin: function(origin, callback) {
    // En production, utiliser la whitelist
    if (isProduction) {
      const whitelist = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
      
      if (whitelist.length === 0) {
        callback(new Error('ALLOWED_ORIGINS non configuré'));
        return;
      }
      
      if (!origin || whitelist.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origine non autorisée: ${origin}`));
      }
    } 
    // En développement, accepter toutes les origines
    else {
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Target-Url', 'X-API-Key']
};

// 🔒 Validation des domaines autorisés pour SSRF protection
const getSafeTarget = (targetUrl) => {
  try {
    const parsedUrl = new URL(targetUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    
    // 🔒 Liste des domaines autorisés (à configurer via variables d'environnement)
    const allowedDomains = (process.env.ALLOWED_DOMAINS || '.xtream-codes.com,.xtream.io,.xtream.tv,.iptv.com')
      .split(',')
      .map(domain => domain.trim().toLowerCase())
      .filter(Boolean);
    
    // 🔒 Vérifier si le domaine est autorisé
    const isAllowed = allowedDomains.some(allowedDomain => {
      // Vérifier les sous-domaines (ex: server.xtream-codes.com)
      if (allowedDomain.startsWith('.')) {
        return hostname.endsWith(allowedDomain);
      }
      // Vérifier l'exact match
      return hostname === allowedDomain;
    });
    
    if (!isAllowed) {
      console.warn(`[SECURITE] Domaine non autorisé bloqué: ${hostname}`);
      return null;
    }
    
    // 🔒 Bloquer les protocoles dangereux
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      console.warn(`[SECURITE] Protocole non autorisé bloqué: ${parsedUrl.protocol}`);
      return null;
    }
    
    return parsedUrl;
  } catch (error) {
    console.error('[SECURITE] Erreur validation URL:', error.message);
    return null;
  }
};

// 🔒 Logging sécurisé (masquer les données sensibles en production)
const safeLog = (level, message, data = {}) => {
  if (isProduction) {
    // Masquer les URLs complètes et les paramètres sensibles en production
    const safeData = { ...data };
    
    if (safeData.targetUrl) {
      try {
        const url = new URL(safeData.targetUrl);
        safeData.targetUrl = `${url.protocol}//${url.hostname}/***`;
      } catch (e) {
        safeData.targetUrl = '***';
      }
    }
    
    if (safeData.path && safeData.path.includes('password')) {
      safeData.path = safeData.path.replace(/password=[^&]*/g, 'password=***');
    }
    
    console[level](`[PROXY] ${message}`, safeData);
  } else {
    console[level](`[DEV] ${message}`, data);
  }
};

// ========== MIDDLEWARES ==========
app.use(limiter);
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// 🔒 Middleware d'authentification optionnel
const authMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;
  
  if (validApiKey && apiKey !== validApiKey) {
    safeLog('warn', 'Accès refusé - Clé API invalide', { 
      ip: req.ip,
      apiKey: apiKey ? '***' : 'absente'
    });
    return res.status(401).json({ error: 'Clé API invalide' });
  }
  
  next();
};

// ========== PROXY MIDDLEWARE AMÉLIORÉ ==========
const iptvProxy = createProxyMiddleware({
  router: (req) => {
    const targetUrl = req.get('X-Target-Url') || req.query.target_url;
    
    if (!targetUrl) {
      safeLog('error', 'Erreur Proxy: En-tête X-Target-Url manquant', { ip: req.ip });
      return null;
    }
    
    safeLog('info', 'Nouvelle requête proxy', { 
      ip: req.ip,
      targetUrl: targetUrl,
      method: req.method
    });
    
    // 🔒 Valider le domaine cible
    const safeUrl = getSafeTarget(targetUrl);
    if (!safeUrl) {
      safeLog('warn', 'Requête bloquée - domaine non autorisé', { 
        ip: req.ip,
        targetUrl: targetUrl
      });
      return null;
    }
    
    const targetBase = `${safeUrl.protocol}//${safeUrl.host}`;
    safeLog('info', 'Proxy redirige vers', { targetBase });
    return targetBase;
  },
  pathRewrite: (path) => {
    // Supprimer /api du chemin
    const newPath = path.replace(/^\/api/, '');
    safeLog('debug', 'Réécriture de chemin', { original: path, new: newPath });
    return newPath;
  },
  changeOrigin: true,
  onProxyReq: (proxyReq, req) => {
    // 🔒 Ajouter des headers de sécurité
    proxyReq.setHeader('X-Forwarded-For', req.ip);
    proxyReq.setHeader('X-Real-IP', req.ip);
    
    // 🔒 User-Agent personnalisé pour les services IPTV
    if (!proxyReq.getHeader('User-Agent')) {
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    }
    
    safeLog('debug', 'Proxy envoie requête', { 
      path: proxyReq.path,
      host: proxyReq.getHeader('host')
    });
  },
  onError: (err, req, res) => {
    safeLog('error', 'Erreur Proxy', { 
      error: err.message,
      stack: isProduction ? undefined : err.stack,
      ip: req.ip,
      targetUrl: req.get('X-Target-Url')
    });
    
    // 🔒 Ne pas exposer les détails d'erreur en production
    const errorMessage = isProduction 
      ? 'Erreur interne du serveur' 
      : `Erreur Proxy: ${err.message}`;
    
    res.status(502).json({ 
      error: errorMessage,
      code: 'PROXY_ERROR'
    });
  },
  onProxyRes: (proxyRes, req, res) => {
    // 🔒 Supprimer les headers sensibles de la réponse
    const sensitiveHeaders = [
      'server',
      'x-powered-by',
      'set-cookie'
    ];
    
    sensitiveHeaders.forEach(header => {
      if (proxyRes.headers[header]) {
        delete proxyRes.headers[header];
      }
    });
    
    safeLog('info', 'Réponse proxy reçue', { 
      statusCode: proxyRes.statusCode,
      targetUrl: req.get('X-Target-Url')
    });
  }
});

// ========== ROUTES ==========
// Route de santé (sans authentification)
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  res.json({
    status: 'ok',
    uptime: uptime.toFixed(2),
    timestamp: new Date().toISOString(),
    node_env: process.env.NODE_ENV,
    proxy_configured: !!process.env.ALLOWED_DOMAINS
  });
});

// Route de test de configuration (protégée en production)
app.get('/config-test', authMiddleware, (req, res) => {
  if (isProduction && req.ip !== '127.0.0.1') {
    return res.status(403).json({ error: 'Accès refusé en production' });
  }
  
  res.json({
    cors_configured: !!process.env.ALLOWED_ORIGINS,
    allowed_domains: (process.env.ALLOWED_DOMAINS || '').split(',').filter(Boolean),
    rate_limiting: true,
    auth_enabled: !!process.env.API_KEY
  });
});

// Route proxy principale (avec authentification optionnelle)
app.use('/api', authMiddleware, iptvProxy);

// Route de base
app.get('/', (req, res) => {
  res.json({
    name: 'IPTV Proxy Server',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    documentation: '/health pour vérifier l\'état'
  });
});

// ========== GESTION DES ERREURS ==========
app.use((req, res, next) => {
  safeLog('warn', 'Route non trouvée', { 
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  res.status(404).json({ error: 'Route non trouvée', code: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {
  safeLog('error', 'Erreur globale', { 
    error: err.message,
    stack: isProduction ? undefined : err.stack,
    path: req.path,
    ip: req.ip
  });
  
  res.status(500).json({ 
    error: isProduction ? 'Erreur serveur interne' : err.message,
    code: 'INTERNAL_ERROR'
  });
});

// ========== DÉMARRAGE DU SERVEUR ==========
const startServer = () => {
  const server = app.listen(PORT, () => {
    console.log(`🚀`);
    console.log(`🔥 SERVEUR IPTV PROXY DÉMARRÉ`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`🔧 Environnement: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ CORS configuré: ${isProduction ? 'production' : 'développement'}`);
    console.log(`🛡️ Protection SSRF: ${process.env.ALLOWED_DOMAINS ? 'activée' : 'désactivée'}`);
    console.log(`🔑 Authentification API: ${process.env.API_KEY ? 'activée' : 'désactivée'}`);
    console.log(`🚀`);
    
    // 🔒 Vérification de sécurité au démarrage
    setTimeout(() => {
      if (isProduction && !process.env.ALLOWED_ORIGINS) {
        console.warn('⚠️  WARNING: ALLOWED_ORIGINS non configuré en production');
      }
      
      if (isProduction && !process.env.ALLOWED_DOMAINS) {
        console.warn('⚠️  WARNING: ALLOWED_DOMAINS non configuré - risque SSRF');
      }
    }, 1000);
  });
  
  // Gestion des signaux système
  process.on('SIGINT', () => {
    console.log('\n🔄 Arrêt gracieux du serveur...');
    server.close(() => {
      console.log('✅ Serveur arrêté proprement');
      process.exit(0);
    });
    
    // Forcer l'arrêt après 5 secondes
    setTimeout(() => {
      console.log('⏰ Délai dépassé, arrêt forcé');
      process.exit(1);
    }, 5000);
  });
  
  process.on('uncaughtException', (error) => {
    safeLog('error', 'Erreur non capturée', { 
      error: error.message,
      stack: error.stack
    });
  });
  
  process.on('unhandledRejection', (reason) => {
    safeLog('error', 'Promesse non gérée', { 
      reason: reason.message,
      stack: reason.stack
    });
  });
};

// ========== DÉMARRAGE ==========
startServer();

module.exports = app;
