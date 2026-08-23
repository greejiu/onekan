import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mmpsyajgyufdxmmnxqba.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_odr6eVpfut1PbfGcG9vDYQ_pKEVFggA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
