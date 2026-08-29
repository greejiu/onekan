from pathlib import Path

js_path = Path('js/unified-workspace.js')
text = js_path.read_text(encoding='utf-8')
old_read = '''async function read(){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null;if(!user)return null;const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();if(error)throw error;state=normalize(data?.data);return state}'''
new_read = '''async function read(){if(!user){const {data:{session}}=await supabase.auth.getSession();user=session?.user||null}if(!user)return null;const {data,error}=await supabase.from("onekan_state").select("data").eq("user_id",user.id).maybeSingle();if(error)throw error;state=normalize(data?.data);return state}'''
if old_read not in text:
    raise SystemExit('read target not found')
text = text.replace(old_read, new_read, 1)
old_auth = '''supabase.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;if(user)queueMicrotask(init)});const {data:{session}}=await supabase.auth.getSession();if(session?.user){user=session.user;queueMicrotask(init)}'''
new_auth = '''supabase.auth.onAuthStateChange((_e,session)=>{user=session?.user||null;if(user)setTimeout(init,0)});const {data:{session}}=await supabase.auth.getSession();if(session?.user){user=session.user;setTimeout(init,0)}'''
if old_auth not in text:
    raise SystemExit('auth target not found')
text = text.replace(old_auth, new_auth, 1)
js_path.write_text(text, encoding='utf-8')

index_path = Path('index.html')
html = index_path.read_text(encoding='utf-8')
old_version = './js/unified-workspace.js?v=76'
new_version = './js/unified-workspace.js?v=77'
if old_version not in html:
    raise SystemExit('version marker not found')
index_path.write_text(html.replace(old_version, new_version, 1), encoding='utf-8')
