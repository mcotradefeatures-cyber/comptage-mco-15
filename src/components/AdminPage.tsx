import React, { useState, useEffect } from 'react';
import { User } from '../types';

interface AdminPageProps {
  token: string;
  onClose: () => void;
  theme: 'color' | 'day' | 'night';
}

const AdminPage: React.FC<AdminPageProps> = ({ token, onClose, theme }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [personalPrice, setPersonalPrice] = useState<number>(200);
  const [teamPrice, setTeamPrice] = useState<number>(1000);
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchConfig();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const usersTimer = setInterval(fetchUsers, 10000);
    return () => {
      clearInterval(timer);
      clearInterval(usersTimer);
    };
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/admin/config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.prices) {
        setPersonalPrice(data.prices.personal);
        setTeamPrice(data.prices.team);
      }
    } catch (err) {
      console.error('Erreur config:', err);
    }
  };

  const updatePrice = async () => {
    setIsUpdatingPrice(true);
    try {
      const response = await fetch('/api/admin/update-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ personalPrice, teamPrice }),
      });
      if (!response.ok) throw new Error('Erreur mise à jour prix');
      alert('Prix mis à jour avec succès !');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateSubscription = async (userId: string, action: string) => {
    if (action === '') return;
    try {
      const response = await fetch('/api/admin/update-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, action }),
      });
      if (!response.ok) throw new Error('Erreur lors de la mise à jour');
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const deleteUser = async (userId: string) => {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erreur lors de la suppression');
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const toggleBlacklist = async (userId: string) => {
    try {
      const response = await fetch('/api/admin/toggle-blacklist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });
      if (!response.ok) throw new Error('Erreur');
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const updateAccountType = async (userId: string, accountType: string) => {
    try {
      const response = await fetch('/api/admin/update-account-type', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, accountType }),
      });
      if (!response.ok) throw new Error('Erreur lors de la mise à jour du type de compte');
      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const formatCountdown = (endTime: number) => {
    const diff = endTime - now;
    if (diff <= 0) return 'Expiré';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    if (days > 0) return `${days}j ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${secs}s`;
  };

  const bgClass = theme === 'night' ? 'bg-[#1a1a1a] text-white' : 'bg-white text-black';
  const tableBorder = theme === 'night' ? 'border-white/10' : 'border-black/5';
  const selectClass = theme === 'night' ? 'bg-[#333] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-black';

  return (
    <div className={`fixed inset-0 z-[110] flex flex-col ${bgClass}`}>
      <header className="p-2 px-4 border-b flex justify-between items-center shrink-0 gap-4">
        <h1 className="text-sm font-black uppercase tracking-tighter whitespace-nowrap">Administration MCO</h1>
        
        {/* CONFIGURATION GLOBALE */}
        <div className={`flex-1 max-w-2xl px-3 py-1.5 rounded-lg border ${tableBorder} ${theme === 'night' ? 'bg-white/5' : 'bg-gray-50'} flex items-center justify-between`}>
          <div className="flex items-center gap-4">
            <h2 className="text-[10px] font-bold uppercase opacity-50 hidden sm:block">Config Globale</h2>
            <div className="flex items-center gap-2">
              <label className="text-[9px] font-bold uppercase opacity-50">Perso (Ar):</label>
              <input 
                type="number" 
                value={personalPrice}
                onChange={(e) => setPersonalPrice(Number(e.target.value))}
                className={`w-16 sm:w-20 p-1 rounded border outline-none text-[10px] font-bold ${selectClass}`}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[9px] font-bold uppercase opacity-50">Équipe (Ar):</label>
              <input 
                type="number" 
                value={teamPrice}
                onChange={(e) => setTeamPrice(Number(e.target.value))}
                className={`w-16 sm:w-20 p-1 rounded border outline-none text-[10px] font-bold ${selectClass}`}
              />
            </div>
          </div>
          <button 
            onClick={updatePrice}
            disabled={isUpdatingPrice}
            className={`px-3 py-1 rounded bg-blue-500 text-white text-[9px] font-bold uppercase tracking-wider active:scale-95 transition-all ${isUpdatingPrice ? 'opacity-50' : ''}`}
          >
            {isUpdatingPrice ? '...' : 'Enregistrer'}
          </button>
        </div>

        <button onClick={onClose} className="w-6 h-6 rounded-full flex items-center justify-center bg-red-500 text-white text-xs shrink-0">
          <i className="fa-solid fa-xmark"></i>
        </button>
      </header>

      <main className="flex-1 overflow-auto p-2 px-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">Chargement...</div>
        ) : error ? (
          <div className="text-red-500 text-center">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[9px] font-bold uppercase opacity-50">
                  <th className={`p-1 border-b ${tableBorder}`}>Email</th>
                  <th className={`p-1 border-b ${tableBorder}`}>Société</th>
                  <th className={`p-1 border-b ${tableBorder}`}>Mobile</th>
                  <th className={`p-1 border-b ${tableBorder}`}>Inscrit le</th>
                  <th className={`p-1 border-b ${tableBorder}`}>Type</th>
                  <th className={`p-1 border-b ${tableBorder}`}>Abonnement</th>
                  <th className={`p-1 border-b ${tableBorder} w-8`}></th>
                </tr>
              </thead>
              <tbody className="text-[10px]">
                {users.map((u) => {
                  const subEnd = u.subscription_end || 0;
                  const isSubscribed = subEnd > now;
                  
                  return (
                    <tr key={u.id} className="hover:bg-black/5 transition-colors">
                      <td className={`p-1 border-b ${tableBorder} truncate max-w-[100px]`}>{u.email.toLowerCase()}</td>
                      <td className={`p-1 border-b ${tableBorder} truncate max-w-[80px]`}>{u.company_name || '-'}</td>
                      <td className={`p-1 border-b ${tableBorder} truncate max-w-[80px]`}>{u.mobile || '-'}</td>
                      <td className={`p-1 border-b ${tableBorder}`}>{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className={`p-1 border-b ${tableBorder}`}>
                        <select 
                          value={u.account_type}
                          onChange={(e) => updateAccountType(u.id, e.target.value)}
                          className={`text-[9px] font-bold uppercase p-0.5 rounded outline-none ${selectClass} ${u.account_type === 'team' ? 'text-purple-500' : 'text-blue-500'}`}
                        >
                          <option value="personal">Personnel (1)</option>
                          <option value="team">Équipe (5)</option>
                        </select>
                      </td>
                      <td className={`p-1 border-b ${tableBorder}`}>
                        <div className="flex items-center gap-1">
                          <div className={`font-bold w-[85px] truncate flex items-center gap-1.5 ${isSubscribed ? 'text-green-500' : 'text-red-500'}`}>
                            <i className={`fa-solid ${isSubscribed ? 'fa-unlock' : 'fa-lock'}`}></i>
                            {isSubscribed ? formatCountdown(subEnd) : 'Bloqué'}
                          </div>
                          <select 
                            className={`text-[9px] p-0.5 rounded border outline-none ${selectClass}`}
                            onChange={(e) => updateSubscription(u.id, e.target.value)}
                            value=""
                          >
                            <option value="">Modif...</option>
                            <option value="1min">1 min</option>
                            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                              <option key={m} value={`${m}m`}>{m} Mois</option>
                            ))}
                            <option value="couper">Couper</option>
                          </select>
                        </div>
                      </td>
                      <td className={`p-1 border-b ${tableBorder} text-right`}>
                        <button 
                          onClick={() => deleteUser(u.id)}
                          className="w-5 h-5 rounded bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors"
                          title="Supprimer l'utilisateur"
                        >
                          <i className="fa-solid fa-trash text-[10px]"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPage;
