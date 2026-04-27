import { useState, useEffect } from "react";
import { Lock, User } from "lucide-react";
import { cn } from "../lib/utils";

export default function Login() {
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await window.electronAPI?.auth?.getUsers();
      if (data) setUsers(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!selectedUser || !pin) return;

    try {
      const res = await window.electronAPI?.auth?.login({ username: selectedUser.username, password: pin });
      if (res?.success) {
        window.location.reload(); // Reloads the app to initialize authenticated state
      } else {
        setError(res?.error || "Invalid PIN");
      }
    } catch (err) {
      setError("Login failed");
    }
  };

  return (
    <div className="flex h-screen w-full bg-surface-1 overflow-hidden">
      <div className="hidden lg:flex flex-col w-[60%] bg-gradient-to-br from-[#0f4c35] to-[#0a2f20] text-white p-12 justify-between relative overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-accent rounded-full mix-blend-multiply filter blur-[128px] opacity-40 animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-primary-light rounded-full mix-blend-multiply filter blur-[128px] opacity-60" />
        
        <div className="z-10 relative">
          <div className="flex items-center gap-4 mb-8">
            <img
              src="./brand/gujjar-logo-square.png"
              alt="Gujjar Milk Shop"
              className="w-20 h-20 rounded-2xl bg-white object-cover shadow-2xl border border-white/30"
            />
            <div className="hidden">
              🐄
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight">Gujjar Milk Shop</h1>
              <p className="text-primary-light/80 text-lg font-medium mt-1 tracking-wide uppercase">Point of Sale System</p>
            </div>
          </div>
          
          <div className="mt-20 max-w-xl">
            <h2 className="text-5xl font-bold leading-tight mb-6">Start your shift.</h2>
            <ul className="space-y-4 text-lg text-white/80">
              <li className="flex items-center gap-3"><span className="w-6 h-6 rounded-full bg-accent text-surface-1 flex items-center justify-center font-bold text-sm">✓</span>Select your account</li>
              <li className="flex items-center gap-3"><span className="w-6 h-6 rounded-full bg-accent text-surface-1 flex items-center justify-center font-bold text-sm">✓</span>Enter your secure PIN</li>
              <li className="flex items-center gap-3"><span className="w-6 h-6 rounded-full bg-accent text-surface-1 flex items-center justify-center font-bold text-sm">✓</span>Ready to serve customers</li>
            </ul>
          </div>
        </div>
        
        <div className="z-10 text-sm text-white/50">
          © {new Date().getFullYear()} Gujjar Milk Shop. All rights reserved.
        </div>
      </div>
      
      <div className="flex-1 flex flex-col justify-center items-center p-8 bg-surface-1 relative">
        <div className="w-full max-w-md space-y-8 animate-slide-up">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-text-primary">Shift Login 👋</h2>
            <p className="text-text-secondary mt-2">Select your name and enter PIN.</p>
          </div>

          {!selectedUser ? (
            <div className="grid grid-cols-2 gap-4 mt-8">
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="bg-surface-2 hover:bg-surface-3 border border-surface-4 rounded-xl p-4 flex flex-col items-center justify-center gap-3 transition-all hover:scale-105 shadow-sm"
                >
                  <div className="w-12 h-12 bg-primary/20 text-primary rounded-full flex items-center justify-center">
                    <User className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-text-primary">{u.name}</div>
                    <div className="text-[10px] text-text-secondary uppercase font-bold tracking-widest">{u.role}</div>
                  </div>
                </button>
              ))}
              {users.length === 0 && (
                <div className="col-span-2 text-center text-text-secondary p-8 bg-surface-2 rounded-xl">No users found. Ensure default admin is created.</div>
              )}
            </div>
          ) : (
            <form className="space-y-6 mt-8" onSubmit={handleLogin}>
              <div className="bg-surface-2 border border-surface-4 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/20 text-primary rounded-full flex items-center justify-center"><User className="w-5 h-5" /></div>
                  <div>
                    <div className="font-bold text-text-primary">{selectedUser.name}</div>
                    <div className="text-[10px] text-text-secondary uppercase font-bold tracking-widest">{selectedUser.role}</div>
                  </div>
                </div>
                <button type="button" onClick={() => { setSelectedUser(null); setPin(""); setError(""); }} className="text-xs text-info hover:underline">Change</button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-secondary uppercase tracking-wider block">Enter PIN</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                  <input 
                    type="password" 
                    placeholder="••••"
                    maxLength={4}
                    value={pin}
                    onChange={e => setPin(e.target.value)}
                    autoFocus
                    className="w-full bg-surface-2 border border-surface-4 text-text-primary rounded-lg pl-10 pr-4 py-4 text-center text-2xl tracking-[1em] focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all shadow-inner font-mono"
                  />
                </div>
                {error && <p className="text-danger text-sm text-center font-bold">{error}</p>}
              </div>
              
              <button className="btn-primary w-full h-14 text-lg font-bold shadow-glow mt-4">
                Start Shift ✓
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
