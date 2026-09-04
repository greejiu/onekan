import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { createOnekanStateStore } from "./state-store.js?v=1";

const SUPABASE_URL = "https://mmpsyajgyufdxmmnxqba.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_odr6eVpfut1PbfGcG9vDYQ_pKEVFggA";

const rawSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export const supabase = rawSupabase;
export const onekanStateStore = createOnekanStateStore(rawSupabase);
