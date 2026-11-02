try { require('dotenv').config(); } catch (_) {}
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Check if credentials exist
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!isConfigured) {
    console.warn(`
⚠️  [WARNING] Supabase environment variables are not configured!
    Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file
    or in Vercel Project Settings -> Environment Variables.
`);
}

// Create Supabase Admin client with service_role privileges
// This client runs ONLY on the server and is never exposed to the client browser.
const supabase = isConfigured
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    })
    : null;

module.exports = {
    supabase,
    isConfigured,
    SUPABASE_URL
};
