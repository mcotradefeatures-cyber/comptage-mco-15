import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { HistoryEntry, TableData } from './src/types';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  // Disable caching for all requests to prevent stale content
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Health check route - must be first
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', time: Date.now(), env: process.env.NODE_ENV });
});

const JWT_SECRET = process.env.JWT_SECRET || 'comptage-mco-secret-key';

// Supabase Initialization
const supabaseUrl = process.env.SUPABASE_URL || 'https://doygmzbgtiaylwfspsdf.supabase.co';
// Use SERVICE_ROLE_KEY if available for backend operations to bypass RLS
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRveWdtemJndGlheWx3ZnNwc2RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMTYxODMsImV4cCI6MjA4Nzg5MjE4M30.yYba9R9k2hl956hPr1KnLNCPPqplSaBZqKat6WtMkMg';

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('🔑 Supabase key type:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE' : 'ANON');

// Helper to get subscription prices
async function getSubscriptionPrices() {
  try {
    const { data } = await supabase.from('config').select('key, value').in('key', ['personal_price', 'team_price']);
    const prices = { personal: 200, team: 1000 };
    if (data) {
      data.forEach(item => {
        if (item.key === 'personal_price') prices.personal = Number(item.value);
        if (item.key === 'team_price') prices.team = Number(item.value);
      });
    }
    return prices;
  } catch (e) {
    return { personal: 200, team: 1000 };
  }
}

// Seed Admin User
async function seedAdmin() {
  try {
    console.log('Running seedAdmin...');
    const adminEmail = 'mco.tradefeatures@gmail.com';
    
    const { data: admin, error: checkError } = await supabase.from('users').select('id').eq('email', adminEmail).single();
    
    if (checkError && checkError.code !== 'PGRST116') {
      console.error(`Seed Admin Check Error for ${adminEmail}:`, checkError.message);
      return;
    }

    const passwordHash = await bcrypt.hash('Rina2204@', 10);

    if (!admin) {
      console.log(`Admin user ${adminEmail} not found, creating...`);
      const adminUser = {
        id: '00000000-0000-0000-0000-000000000002',
        email: adminEmail,
        password_hash: passwordHash,
        role: 'admin',
        account_type: 'team',
        created_at: Date.now(),
        company_name: 'dinosoresecret',
        mobile: '2204@',
        subscription_end: Date.now() + (100 * 365 * 24 * 60 * 60 * 1000)
      };
      const { error: insertError } = await supabase.from('users').upsert([adminUser], { onConflict: 'email' });
      if (insertError) console.error(`Seed Admin Insert Error for ${adminEmail}:`, insertError.message);
    } else {
      console.log(`Admin user ${adminEmail} found, updating...`);
      await supabase.from('users').update({ 
        password_hash: passwordHash,
        role: 'admin',
        company_name: 'dinosoresecret',
        mobile: '2204@',
        subscription_end: Date.now() + (100 * 365 * 24 * 60 * 60 * 1000)
      }).eq('email', adminEmail);
    }
  } catch (err: any) {
    console.error('Seed Admin Exception:', err.message);
  }
}

seedAdmin();

// Helper to check and sync admin status
async function syncAdminStatus(email: string, userId: string) {
  const isMainAdmin = email.trim().toLowerCase() === 'mco.tradefeatures@gmail.com';
  
  // Check if email is in admins table
  let isListedAdmin = false;
  try {
    const { data } = await supabase.from('admins').select('email').eq('email', email.trim().toLowerCase()).single();
    isListedAdmin = !!data;
  } catch (e) {
    // Table might not exist, ignore
  }

  const isAdmin = isMainAdmin || isListedAdmin;

  if (isAdmin) {
    // Ensure they are in the admins table if not already (for listed admins or main admin)
    try {
      const { data: existing } = await supabase.from('admins').select('email').eq('email', email.trim().toLowerCase()).single();
      if (!existing) {
        await supabase.from('admins').insert([{ email: email.trim().toLowerCase(), created_at: Date.now() }]);
      }
    } catch (e) {
      // Table might not exist, ignore
    }
  }

  return isAdmin;
}

app.post('/api/auth/admin-bypass', async (req, res) => {
  try {
    const { email, companyName, mobile } = req.body;
    const cleanEmail = email.trim().toLowerCase();
    
    const isMainAdmin = cleanEmail === 'mco.tradefeatures@gmail.com';

    if (!isMainAdmin || companyName !== 'dinosoresecret' || mobile !== '2204@') {
      return res.status(403).json({ error: 'Accès refusé ou informations incorrectes' });
    }

    // Special admin user ID (static or generated)
    const adminId = '00000000-0000-0000-0000-000000000002';
    
    // Find or create in users table
    let { data: user, error: fetchError } = await supabase.from('users').select('*').eq('email', cleanEmail).single();
    
    if (fetchError && fetchError.code === 'PGRST116') {
      const newUser = {
        id: adminId,
        email: cleanEmail,
        password_hash: 'admin_bypass',
        role: 'admin',
        account_type: 'team',
        company_name: companyName,
        mobile: mobile,
        created_at: Date.now(),
        subscription_end: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000
      };
      const { error: insertError } = await supabase.from('users').insert([newUser]);
      if (insertError) throw insertError;
      user = newUser;
    } else {
      // Update IP and other info
      const { data: updatedUser } = await supabase.from('users').update({ 
        company_name: companyName,
        mobile: mobile,
        role: 'admin'
      }).eq('id', user.id).select().single();
      if (updatedUser) user = updatedUser;
    }

    const token = jwt.sign({ userId: user!.id }, JWT_SECRET);
    const { password_hash, ...userWithoutPass } = user!;
    res.json({ token, user: userWithoutPass });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erreur bypass admin' });
  }
});

app.post('/api/auth/supabase-login', async (req, res) => {
  try {
    const { access_token, registrationData } = req.body;
    if (!access_token) return res.status(400).json({ error: 'Token requis' });

    // Verify token with Supabase
    const { data: { user: sbUser }, error: sbError } = await supabase.auth.getUser(access_token);
    if (sbError || !sbUser) {
      return res.status(401).json({ error: 'Token Supabase invalide' });
    }

    const email = sbUser.email!.trim().toLowerCase();
    
    if (email === 'mco.tradefeatures@gmail.com') {
      if (registrationData?.companyName !== 'dinosoresecret' || registrationData?.mobile !== '2204@') {
        return res.status(403).json({ error: 'Informations secrètes incorrectes pour cet administrateur' });
      }
    }

    const isAdmin = await syncAdminStatus(email, sbUser.id);
    const currentIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
    
    // Find or create user in our custom table
    let { data: user, error: fetchError } = await supabase.from('users').select('*').eq('email', email).single();
    
    if (fetchError && fetchError.code === 'PGRST116') {
      // User doesn't exist in our table, create them
      const metadata = sbUser.user_metadata || {};
      const newUser = {
        id: sbUser.id, // Use Supabase Auth ID
        email: email,
        password_hash: 'supabase_auth', // Placeholder
        role: isAdmin ? 'admin' : 'user',
        account_type: metadata.account_type || (isAdmin ? 'team' : 'personal'),
        company_name: registrationData?.companyName || metadata.company_name || (isAdmin ? 'ADMIN MCO' : 'Nouveau Compte'),
        mobile: registrationData?.mobile || metadata.mobile || '',
        created_at: Date.now(),
        subscription_end: isAdmin ? Date.now() + 100 * 365 * 24 * 60 * 60 * 1000 : Date.now() + 30 * 60 * 1000
      };
      const { error: insertError } = await supabase.from('users').insert([newUser]);
      if (insertError) throw insertError;
      user = newUser;
    } else if (fetchError) {
      throw fetchError;
    } else {
      // Update existing user with new registration data if provided
      const updates: any = {};
      if (registrationData?.companyName) updates.company_name = registrationData.companyName;
      if (registrationData?.mobile) updates.mobile = registrationData.mobile;
      if (isAdmin && user.role !== 'admin') {
        updates.role = 'admin';
        updates.subscription_end = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
      }
      
      if (Object.keys(updates).length > 0) {
        const { data: updatedUser, error: updateError } = await supabase.from('users').update(updates).eq('id', user.id).select().single();
        if (!updateError) user = updatedUser;
      }
    }

    // Issue our custom JWT
    const token = jwt.sign({ userId: user!.id }, JWT_SECRET);
    const { password_hash, ...userWithoutPass } = user!;
    res.json({ token, user: userWithoutPass });
  } catch (err: any) {
    console.error('Supabase Login Error:', err);
    res.status(500).json({ 
      error: err.message || 'Erreur lors de la connexion Supabase',
    });
  }
});

// MVola Payment Logic
const MVOLA_CONFIG = {
  clientId: process.env.MVOLA_CLIENT_ID?.trim(),
  clientSecret: process.env.MVOLA_CLIENT_SECRET?.trim(),
  merchantNumber: process.env.MVOLA_MERCHANT_NUMBER?.trim().replace('+', ''),
  env: process.env.MVOLA_ENVIRONMENT?.trim() || 'sandbox',
  callbackUrl: process.env.MVOLA_CALLBACK_URL?.trim(),
};

async function getMVolaToken() {
  console.log('MVola Config Env:', MVOLA_CONFIG.env);
  
  // Sécurité : Vérifier si on utilise les clés de test en production
  if (MVOLA_CONFIG.env === 'production' && MVOLA_CONFIG.clientId === 'QmwjHpgEEvDpgMs82Wd4LEPoqYUa') {
    throw new Error("ALERTE : Vous utilisez un Client ID de TEST (Sandbox) alors que vous êtes en mode 'production'. Veuillez remplacer vos clés dans les Secrets par vos identifiants de production réels.");
  }

  const url = MVOLA_CONFIG.env === 'production' 
    ? 'https://api.mvola.mg/token' 
    : 'https://devapi.mvola.mg/token';
  
  if (!MVOLA_CONFIG.clientId || !MVOLA_CONFIG.clientSecret) {
    throw new Error('MVola Client ID or Secret is missing in environment variables');
  }
  
  const auth = Buffer.from(`${MVOLA_CONFIG.clientId}:${MVOLA_CONFIG.clientSecret}`).toString('base64');
  
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'EXT_INT_MVOLA_SCOPE');
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: params.toString()
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.error('MVola Token Error:', response.status, errorBody);
    
    if (response.status === 401) {
      throw new Error(`Erreur d'authentification MVola (401): Vos identifiants Client ID/Secret sont invalides pour l'environnement '${MVOLA_CONFIG.env}'. Vérifiez vos Secrets.`);
    }
    
    throw new Error(`Failed to get MVola token: ${response.status} ${errorBody}`);
  }
  const data = await response.json();
  return data.access_token;
}

app.post('/api/payment/mvola/initiate', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non autorisé' });
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: user } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Numéro de téléphone requis' });

    const mvolaToken = await getMVolaToken();
    const baseUrl = MVOLA_CONFIG.env === 'production'
      ? 'https://api.mvola.mg'
      : 'https://devapi.mvola.mg';
    
    const url = `${baseUrl}/mvola/mm/transactions/type/merchantpay/1.0.0/`;

    const correlationId = Date.now().toString();
    const prices = await getSubscriptionPrices();
    const amount = user.account_type === 'team' ? prices.team : prices.personal;

    // Format date as per documentation: yyyy-MM-dd'T'HH:mm:ss.SSSZ
    const requestDate = new Date().toISOString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mvolaToken}`,
        'Version': '1.0',
        'X-CorrelationID': correlationId,
        'UserLanguage': 'FR',
        'UserAccountIdentifier': `msisdn;${MVOLA_CONFIG.merchantNumber}`,
        'partnerName': user.company_name || 'MCO',
        'X-Callback-URL': MVOLA_CONFIG.callbackUrl || '',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        amount: amount.toString(),
        currency: 'Ar',
        descriptionText: `Abonnement 1 mois - ${user.email}`,
        requestDate: requestDate,
        requestingOrganisationTransactionReference: `REQ-${user.id}-${Date.now()}`,
        debitParty: [{ key: 'msisdn', value: phoneNumber.replace(/\s/g, '') }],
        creditParty: [{ key: 'msisdn', value: MVOLA_CONFIG.merchantNumber }],
        metadata: [
          { key: 'userId', value: user.id },
          { key: 'partnerName', value: user.company_name || 'MCO' }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('MVola Initiation Error:', response.status, errorData);
      throw new Error(`Erreur lors de l'initiation du paiement MVola: ${response.status}`);
    }

    const data = await response.json();
    res.json({ 
      status: 'pending', 
      serverCorrelationId: data.serverCorrelationId,
      message: 'Demande envoyée sur votre téléphone. Veuillez confirmer avec votre code secret.'
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payment/mvola/callback', express.json(), async (req, res) => {
  const { status, metadata } = req.body;
  
  if (status === 'completed') {
    const userId = metadata?.find((m: any) => m.key === 'userId')?.value;
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (user) {
      const monthMs = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const start = Math.max(now, user.subscription_end || 0);
      const newEnd = start + monthMs;
      
      const { data: updatedUser } = await supabase.from('users').update({ subscription_end: newEnd }).eq('id', userId).select().single();
      
      if (updatedUser) {
        const { password_hash, ...userWithoutPass } = updatedUser;
        clients.get(userId)?.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'user_update', user: userWithoutPass }));
          }
        });
      }
    }
  }
  res.status(204).send();
});

app.get('/api/admin/users', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non autorisé' });
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    const { data: users } = await supabase.from('users').select('*').neq('role', 'admin');
    res.json(users?.map(u => {
      const { password_hash, ...rest } = u;
      return rest;
    }) || []);
  } catch (e) {
    res.status(401).json({ error: 'Token invalide' });
  }
});

app.get('/api/config', async (req, res) => {
  const prices = await getSubscriptionPrices();
  res.json({ prices });
});

app.get('/api/admin/config', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non autorisé' });
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    const prices = await getSubscriptionPrices();
    res.json({ prices });
  } catch (e) {
    res.status(401).json({ error: 'Token invalide' });
  }
});

app.post('/api/admin/update-config', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non autorisé' });
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    const { personalPrice, teamPrice } = req.body;
    
    const updates = [];
    if (typeof personalPrice === 'number' && personalPrice >= 0) {
      updates.push({ key: 'personal_price', value: personalPrice.toString() });
    }
    if (typeof teamPrice === 'number' && teamPrice >= 0) {
      updates.push({ key: 'team_price', value: teamPrice.toString() });
    }
    
    if (updates.length > 0) {
      await supabase.from('config').upsert(updates);
      res.json({ success: true, prices: { personal: personalPrice, team: teamPrice } });
    } else {
      res.status(400).json({ error: 'Prix invalide' });
    }
  } catch (e) {
    res.status(401).json({ error: 'Token invalide' });
  }
});

app.post('/api/admin/update-subscription', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId, action } = req.body;
  
  try {
    const token = authHeader!.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    const minuteMs = 60 * 1000;
    const now = Date.now();
    let newEnd = user.subscription_end;

    if (action === '1min') {
      newEnd = now + minuteMs;
    } else if (action.endsWith('m')) {
      const months = parseInt(action);
      const start = Math.max(now, user.subscription_end || 0);
      newEnd = start + (months * monthMs);
    } else if (action === 'couper') {
      newEnd = now;
    }
    
    await supabase.from('users').update({ subscription_end: newEnd }).eq('id', userId);
    res.json({ success: true, subscriptionEnd: newEnd });
  } catch (e) {
    res.status(401).json({ error: 'Erreur' });
  }
});

app.post('/api/admin/update-account-type', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId, accountType } = req.body;
  
  try {
    const token = authHeader!.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    if (accountType !== 'personal' && accountType !== 'team') {
      return res.status(400).json({ error: 'Type invalide' });
    }
    
    const { data: updatedUser } = await supabase.from('users').update({ account_type: accountType }).eq('id', userId).select().single();
    
    if (updatedUser) {
      const { password_hash, ...userWithoutPass } = updatedUser;
      clients.get(userId)?.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'user_update', user: userWithoutPass }));
        }
      });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
  } catch (e) {
    res.status(401).json({ error: 'Erreur' });
  }
});

app.post('/api/user/update-company-name', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non autorisé' });
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { companyName } = req.body;
    
    if (!companyName || typeof companyName !== 'string') {
      return res.status(400).json({ error: 'Nom invalide' });
    }
    
    const { data: updatedUser } = await supabase.from('users').update({ company_name: companyName }).eq('id', decoded.userId).select().single();
    
    if (updatedUser) {
      res.json({ user: updatedUser });
    } else {
      res.status(400).json({ error: 'Erreur mise à jour' });
    }
  } catch (e) {
    res.status(401).json({ error: 'Erreur' });
  }
});

app.post('/api/user/update-account-type', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non autorisé' });
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { accountType } = req.body;
    
    if (accountType !== 'personal' && accountType !== 'team') {
      return res.status(400).json({ error: 'Type invalide' });
    }
    
    const { data: updatedUser } = await supabase.from('users').update({ account_type: accountType }).eq('id', decoded.userId).select().single();
    
    if (updatedUser) {
      const { password_hash, ...userWithoutPass } = updatedUser;
      clients.get(decoded.userId)?.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'user_update', user: userWithoutPass }));
        }
      });
      res.json({ success: true, user: userWithoutPass });
    } else {
      res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
  } catch (e) {
    res.status(401).json({ error: 'Erreur' });
  }
});

app.post('/api/admin/add-user', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { email, password, companyName, mobile, accountType } = req.body;
  
  try {
    const token = authHeader!.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    
    const cleanEmail = email.toLowerCase().trim();
    const { data: existingUser } = await supabase.from('users').select('id').eq('email', cleanEmail).single();
    if (existingUser) return res.status(400).json({ error: 'Cet email existe déjà' });
    
    const password_hash = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      email: cleanEmail,
      password_hash,
      company_name: companyName || '',
      mobile: mobile || '',
      account_type: accountType || 'personal',
      role: 'user',
      subscription_end: Date.now() + 30 * 24 * 60 * 60 * 1000, // 1 mois par défaut
      created_at: new Date().toISOString()
    };
    
    const { error: insertError } = await supabase.from('users').insert([newUser]);
    if (insertError) throw insertError;
    
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Erreur lors de la création' });
  }
});

app.post('/api/admin/delete-user-by-email', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { email } = req.body;
  
  try {
    const token = authHeader!.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    if (!email) return res.status(400).json({ error: 'Email requis' });
    
    const cleanEmail = email.toLowerCase().trim();
    const { data: user } = await supabase.from('users').select('id').eq('email', cleanEmail).single();
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    
    await supabase.from('users').delete().eq('id', user.id);
    clients.get(user.id)?.forEach(ws => ws.close());
    clients.delete(user.id);
    
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Erreur lors de la suppression' });
  }
});

app.post('/api/admin/delete-user', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId } = req.body;
  try {
    const token = authHeader!.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    // Try to delete from Supabase Auth if we have admin privileges
    try {
      const { error: authError } = await supabase.auth.admin.deleteUser(userId);
      if (authError) console.warn("Could not delete from auth.users:", authError.message);
    } catch (e) {
      console.warn("Auth deletion failed");
    }

    const { error, count } = await supabase.from('users').delete({ count: 'exact' }).eq('id', userId);
    if (error) {
      console.error("Erreur suppression table users:", error);
      return res.status(500).json({ error: error.message });
    }
    
    if (count === 0) {
      return res.status(500).json({ error: "Impossible de supprimer l'utilisateur. Vérifiez les droits RLS ou la clé SUPABASE_SERVICE_ROLE_KEY." });
    }
    
    clients.get(userId)?.forEach(ws => ws.close());
    clients.delete(userId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(401).json({ error: e.message || 'Erreur' });
  }
});

app.post('/api/admin/toggle-blacklist', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId } = req.body;
  try {
    const token = authHeader!.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { data: admin } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (user) {
      const newStatus = !user.is_blacklisted;
      await supabase.from('users').update({ is_blacklisted: newStatus }).eq('id', userId);
      if (newStatus) {
        clients.get(userId)?.forEach(ws => ws.close());
        clients.delete(userId);
      }
      res.json({ success: true, isBlacklisted: newStatus });
    } else {
      res.status(404).json({ error: 'Non trouvé' });
    }
  } catch (e) {
    res.status(401).json({ error: 'Erreur' });
  }
});

// WebSocket logic
const clients = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws, req) => {
  let userId: string | null = null;
  const currentIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();

  ws.on('message', async (message) => {
    const data = JSON.parse(message.toString());

    if (data.type === 'auth') {
      try {
        const decoded = jwt.verify(data.token, JWT_SECRET) as any;
        userId = decoded.userId;
        const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
        
        if (userId && user) {
          if (user.is_blacklisted) {
            ws.send(JSON.stringify({ type: 'error', message: 'Votre compte est sur liste noire.' }));
            ws.close();
            return;
          }

          // IP check for session persistence security
          // Removed last_ip check as the column doesn't exist in the schema cache
          const currentClients = clients.get(userId) || new Set();
          const limit = user.account_type === 'team' ? 5 : 1;
          if (currentClients.size >= limit && user.role !== 'admin') {
            ws.send(JSON.stringify({ type: 'error', message: `Limite de connexion atteinte (${limit} max)` }));
            ws.close();
            return;
          }

          if (!clients.has(userId)) clients.set(userId, new Set());
          clients.get(userId)!.add(ws);
          
          const { data: stateData } = await supabase.from('user_data').select('state').eq('user_id', userId).single();
          if (stateData) {
            ws.send(JSON.stringify({ type: 'init', state: stateData.state }));
          }
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
      }
    }

    if (data.type === 'update' && userId) {
      await supabase.from('user_data').upsert({ user_id: userId, state: data.state });
      clients.get(userId)?.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'update', state: data.state }));
        }
      });
    }
  });

  ws.on('close', () => {
    if (userId && clients.has(userId)) {
      clients.get(userId)!.delete(ws);
      if (clients.get(userId)!.size === 0) clients.delete(userId);
    }
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Setting up Vite middleware for development...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite middleware ready.');
  } else {
    console.log('Serving static files for production...');
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();