import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, HistoryEntry } from '../types';

interface DashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  token: string | null;
  history: HistoryEntry[];
  onLoadEntry: (entry: HistoryEntry) => void;
  onLogout: () => void;
  onPay: () => void;
  onOpenAdmin: () => void;
  theme: 'color' | 'day' | 'night';
  currentSubPrice: number;
  companyName: string;
}

const DashboardModal: React.FC<DashboardModalProps> = ({ 
  isOpen, 
  onClose, 
  user, 
  token,
  history, 
  onLoadEntry, 
  onLogout, 
  onPay,
  onOpenAdmin,
  theme,
  currentSubPrice,
  companyName
}) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // Payment state
  const [paymentStep, setPaymentStep] = useState<'idle' | 'phone' | 'initiating' | 'pending' | 'success'>('idle');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [serverCorrelationId, setServerCorrelationId] = useState('');
  const prevSubEnd = React.useRef(user?.subscription_end);

  React.useEffect(() => {
    if (user?.subscription_end && prevSubEnd.current && user.subscription_end > prevSubEnd.current) {
      if (paymentStep === 'pending' || paymentStep === 'initiating') {
        setPaymentStep('success');
        setTimeout(() => setPaymentStep('idle'), 3000);
      }
    }
    prevSubEnd.current = user?.subscription_end;
  }, [user?.subscription_end, paymentStep]);

  const handleInitiatePayment = async () => {
    if (!phoneNumber || phoneNumber.length < 9) {
      setPaymentError('Numéro invalide');
      return;
    }
    setPaymentStep('initiating');
    setPaymentError('');
    try {
      const response = await fetch('/api/payment/mvola/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erreur lors du paiement');
      
      setServerCorrelationId(data.serverCorrelationId);
      setPaymentStep('pending');
    } catch (err: any) {
      setPaymentError(err.message);
      setPaymentStep('phone');
    }
  };

  const handleSimulateSuccess = async () => {
    try {
      await fetch('/api/payment/mvola/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          metadata: [{ key: 'userId', value: user.id }]
        })
      });
    } catch (err) {
      console.error(err);
    }
  };

  const updateAccountType = async (newType: string) => {
    if (!token) return;
    try {
      const response = await fetch('/api/user/update-account-type', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ accountType: newType }),
      });
      if (!response.ok) throw new Error('Erreur lors de la mise à jour');
      // The user state will be updated via WebSocket
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Group history by date
  const historyByDate = useMemo(() => {
    const grouped: Record<string, HistoryEntry[]> = {};
    history.forEach(entry => {
      // entry.date is "DD/MM/YYYY"
      if (!grouped[entry.date]) grouped[entry.date] = [];
      grouped[entry.date].push(entry);
    });
    return grouped;
  }, [history]);

  if (!isOpen) return null;

  const subEnd = user.subscription_end || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const subEndDate = new Date(subEnd);
  subEndDate.setHours(23, 59, 59, 999);
  // Approximate start date of subscription (30 days before end)
  const subStartDate = new Date(subEnd - 30 * 24 * 60 * 60 * 1000);
  subStartDate.setHours(0, 0, 0, 0);

  // Calendar logic
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const totalDays = daysInMonth(year, month);
  const startDay = firstDayOfMonth(year, month);

  const calendarDays = [];
  for (let i = 0; i < startDay; i++) calendarDays.push(null);
  for (let i = 1; i <= totalDays; i++) calendarDays.push(i);

  const formatMonth = (date: Date) => {
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
  };

  const isDayWithHistory = (day: number) => {
    const dateStr = `${day.toString().padStart(2, '0')}/${(month + 1).toString().padStart(2, '0')}/${year}`;
    return !!historyByDate[dateStr];
  };

  const getDayStyle = (day: number) => {
    const currentDayDate = new Date(year, month, day);
    if (currentDayDate >= subStartDate && currentDayDate < today) {
      return 'bg-gray-500/10 text-gray-400'; // Consumed (Gray)
    } else if (currentDayDate >= today && currentDayDate <= subEndDate) {
      return 'bg-blue-500/10 text-blue-400'; // Remaining (Blue)
    }
    return '';
  };

  const getEntriesForDay = (day: number) => {
    const dateStr = `${day.toString().padStart(2, '0')}/${(month + 1).toString().padStart(2, '0')}/${year}`;
    return historyByDate[dateStr] || [];
  };

  const bgClass = theme === 'night' ? 'bg-[#1a1a1a] text-white border-white/10' : 'bg-white text-black border-black/5';
  const cardClass = theme === 'night' ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200';
  const selectClass = theme === 'night' ? 'bg-[#333] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-black';

  // Stats
  const totalCalculations = history.length;
  const last30DaysCount = history.filter(h => {
    const [d, m, y] = h.date.split('/').map(Number);
    const entryDate = new Date(y, m - 1, d);
    return (Date.now() - entryDate.getTime()) < (30 * 24 * 60 * 60 * 1000);
  }).length;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`w-full max-w-2xl p-5 sm:p-8 rounded-3xl shadow-2xl border my-auto relative ${bgClass}`}
      >
        <button onClick={onClose} className="absolute top-6 right-6 opacity-50 hover:opacity-100 transition-opacity font-bold text-2xl">
          ×
        </button>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {/* LEFT COLUMN: ACCOUNT & STATS */}
          <div className="space-y-6">
            <div className={`p-5 rounded-2xl border ${cardClass}`}>
              <div className="flex justify-between items-start">
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-black uppercase tracking-tight text-blue-500 leading-none mb-1 truncate">
                    {companyName !== 'NOM / SOCIÉTÉ' ? companyName : (user.company_name || user.email.split('@')[0])}
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-[11px] font-black uppercase truncate opacity-60">
                      Compte Actif
                    </div>
                    {user.role === 'admin' && (
                      <button 
                        onClick={onOpenAdmin}
                        className="text-[9px] font-bold uppercase opacity-30 hover:opacity-100 transition-opacity flex items-center gap-1 bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-full"
                        title="Accéder à la page Admin"
                      >
                        <i className="fa-solid fa-shield-halved"></i> Admin
                      </button>
                    )}
                  </div>
                  <div className="text-[9px] font-bold opacity-60 uppercase truncate mb-2">
                    {user.email.toLowerCase()}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold opacity-40 uppercase">Type:</span>
                    <select 
                      value={user.account_type}
                      onChange={(e) => updateAccountType(e.target.value)}
                      className={`text-[10px] font-bold uppercase p-1 rounded outline-none ${selectClass}`}
                    >
                      <option value="personal">Personnel (1)</option>
                      <option value="team">Équipe (5)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className={`p-5 rounded-2xl border ${cardClass} relative overflow-hidden min-h-[160px]`}>
              <AnimatePresence mode="wait">
                {paymentStep === 'idle' && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col h-full"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40">Abonnement</h3>
                      <button 
                        onClick={() => setPaymentStep('phone')}
                        className="px-3 py-1 rounded-lg bg-[#006935]/10 text-[#006935] font-black text-[8px] uppercase tracking-widest hover:bg-[#006935]/20 transition-all"
                      >
                        Paiement MVola
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div>
                          <div className="text-[9px] font-bold uppercase opacity-50 mb-1">Temps restant</div>
                          <div className="text-2xl font-black leading-none">
                            {Math.max(0, Math.ceil((subEnd - Date.now()) / (1000 * 60 * 60 * 24)))} <span className="text-xs">Jours</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] font-bold uppercase opacity-50 mb-1">Date limite</div>
                          <div className="text-[11px] font-black">
                            {new Date(subEnd).toLocaleDateString('fr-FR')}
                          </div>
                          <div className="text-[9px] font-bold opacity-40">
                            à {new Date(subEnd).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                      
                      <div className="w-full h-2 bg-black/10 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500 transition-all duration-1000" 
                          style={{ 
                            width: `${Math.max(0, Math.min(100, ((subEnd - Date.now()) / (30 * 24 * 60 * 60 * 1000)) * 100))}%` 
                          }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

                {paymentStep === 'phone' && (
                  <motion.div
                    key="phone"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col h-full justify-center"
                  >
                    <div className="flex justify-between items-center mb-4">
                      <button 
                        onClick={() => setPaymentStep('idle')}
                        className="text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100 flex items-center gap-2"
                      >
                        <i className="fa-solid fa-arrow-left text-[8px]"></i>
                        Retour
                      </button>
                      <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40">Paiement MVola</h3>
                    </div>
                    
                    <div className="text-[10px] font-bold opacity-60 mb-2">Montant à payer : <span className="text-[#006935]">{currentSubPrice.toLocaleString()} Ar</span></div>
                    
                    <div className="p-2 bg-[#ffdd00] rounded-2xl border border-[#ffdd00] mb-2 flex items-center gap-2 shadow-sm relative z-10">
                      <div className="w-12 h-8 flex items-center justify-center shrink-0 overflow-hidden ml-1">
                        <img 
                          src="https://www.mvola.mg/wp-content/uploads/2022/03/Logo-MVola-1.png" 
                          alt="MVola" 
                          className="h-full w-full object-contain scale-150"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.innerHTML = '<span class="text-[#006935] font-black italic text-xs">MVola</span>';
                            }
                          }}
                        />
                      </div>
                      <input 
                        type="tel"
                        placeholder="034 00 000 00"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="w-full p-1 bg-transparent border-none outline-none font-black text-xs text-[#000] placeholder:text-[#000]/30"
                      />
                      <button 
                        onClick={handleInitiatePayment}
                        disabled={!phoneNumber || phoneNumber.length < 9}
                        className={`ml-auto h-8 px-3 rounded-xl bg-[#006935] text-white font-black text-[9px] uppercase tracking-wider flex items-center justify-center transition-all shadow-md ${(!phoneNumber || phoneNumber.length < 9) ? 'opacity-50' : 'active:scale-95 hover:bg-[#005a2d]'}`}
                      >
                        Payer
                      </button>
                    </div>
                    {paymentError && <div className="text-[9px] font-bold text-red-500">{paymentError}</div>}
                  </motion.div>
                )}

                {paymentStep === 'initiating' && (
                  <motion.div
                    key="initiating"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex flex-col items-center justify-center h-full py-4 absolute inset-0"
                  >
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Initiation du paiement...</div>
                  </motion.div>
                )}

                {paymentStep === 'pending' && (
                  <motion.div
                    key="pending"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex flex-col items-center justify-center h-full text-center py-2 absolute inset-0"
                  >
                    <div className="w-10 h-10 bg-yellow-500/20 text-yellow-500 rounded-full flex items-center justify-center mb-3">
                      <i className="fa-solid fa-mobile-screen-button text-lg animate-pulse"></i>
                    </div>
                    <div className="text-[11px] font-black uppercase tracking-widest mb-1">Confirmez sur votre téléphone</div>
                    <div className="text-[9px] font-bold opacity-50 mb-4 px-4">Veuillez entrer votre code secret MVola pour valider le paiement.</div>
                    
                    <div className="flex gap-4 items-center">
                      <button 
                        onClick={() => setPaymentStep('idle')}
                        className="text-[9px] font-black uppercase tracking-widest opacity-40 hover:opacity-100 underline"
                      >
                        Annuler
                      </button>
                      
                      {/* Bouton de simulation pour le développement */}
                      <button 
                        onClick={handleSimulateSuccess}
                        className="text-[8px] font-black uppercase tracking-widest text-blue-500 opacity-50 hover:opacity-100"
                      >
                        Simuler Succès (Dev)
                      </button>
                    </div>
                  </motion.div>
                )}

                {paymentStep === 'success' && (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex flex-col items-center justify-center h-full text-center py-2 absolute inset-0"
                  >
                    <div className="w-10 h-10 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mb-3">
                      <i className="fa-solid fa-check text-xl"></i>
                    </div>
                    <div className="text-[11px] font-black uppercase tracking-widest text-green-500 mb-1">Paiement Réussi !</div>
                    <div className="text-[9px] font-bold opacity-50">Votre abonnement a été mis à jour.</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={onLogout}
              className="text-[9px] font-black uppercase tracking-[0.2em] opacity-20 hover:opacity-100 transition-opacity flex items-center gap-2 mt-2"
            >
              <i className="fa-solid fa-power-off text-[8px]"></i>
              Déconnexion Session
            </button>
          </div>

          {/* RIGHT COLUMN: CALENDAR & HISTORY */}
          <div className="space-y-6">
            <div className={`p-5 rounded-2xl border ${cardClass} relative overflow-hidden min-h-[340px]`}>
              <AnimatePresence mode="wait">
                {!selectedDate ? (
                  <motion.div
                    key="calendar"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="h-full"
                  >
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40">Calendrier d'activité</h3>
                      <div className="flex gap-2">
                        <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="p-1 opacity-50 hover:opacity-100"><i className="fa-solid fa-chevron-left text-xs"></i></button>
                        <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="p-1 opacity-50 hover:opacity-100"><i className="fa-solid fa-chevron-right text-xs"></i></button>
                      </div>
                    </div>
                    
                    <div className="text-center text-xs font-black uppercase mb-4 tracking-tighter">{formatMonth(currentMonth)}</div>

                    <div className="grid grid-cols-7 gap-1 text-center mb-2">
                      {['D', 'L', 'M1', 'M2', 'J', 'V', 'S'].map((d, i) => (
                        <div key={`${d}-${i}`} className="text-[8px] font-black opacity-30">{d.replace(/\d/, '')}</div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {calendarDays.map((day, idx) => {
                        if (day === null) return <div key={`empty-${idx}`} />;
                        const hasHistory = isDayWithHistory(day);
                        const dateStr = `${day.toString().padStart(2, '0')}/${(month + 1).toString().padStart(2, '0')}/${year}`;
                        const dayStyle = getDayStyle(day);
                        
                        return (
                          <button
                            key={day}
                            onClick={() => hasHistory && setSelectedDate(dateStr)}
                            className={`aspect-square rounded-lg flex flex-col items-center justify-center relative transition-all ${
                              hasHistory && !dayStyle ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20' : 
                              !hasHistory && !dayStyle ? 'opacity-40 cursor-default' : ''
                            } ${dayStyle} ${hasHistory ? 'ring-1 ring-green-500/50 hover:opacity-80' : ''}`}
                          >
                            <span className="text-[10px] font-black">{day}</span>
                            {hasHistory && (
                              <div className="w-1 h-1 bg-green-500 rounded-full absolute bottom-1" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="history"
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                    className={`absolute inset-0 p-5 ${bgClass} z-10 flex flex-col`}
                  >
                    <div className="flex justify-between items-center mb-4">
                      <button 
                        onClick={() => setSelectedDate(null)}
                        className="text-[10px] font-black uppercase tracking-widest opacity-40 hover:opacity-100 flex items-center gap-2"
                      >
                        <i className="fa-solid fa-arrow-left text-[8px]"></i>
                        Retour
                      </button>
                      <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40">Calculs du {selectedDate}</h3>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {historyByDate[selectedDate]?.map(entry => (
                        <button
                          key={entry.id}
                          onClick={() => {
                            onLoadEntry(entry);
                            onClose();
                          }}
                          className={`w-full p-3 rounded-xl border text-left transition-all active:scale-[0.98] ${theme === 'night' ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-white border-gray-100 hover:border-blue-200'}`}
                        >
                          <div className="text-[10px] font-black uppercase truncate mb-1">{entry.title}</div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-black text-blue-500">{entry.total.toLocaleString()} Ar</span>
                            <div className="flex items-center gap-2">
                              {(entry.totalBags || 0) > 0 && (
                                <span className="text-[9px] font-bold opacity-60 bg-black/5 px-1.5 py-0.5 rounded-md">
                                  {entry.totalBags} sac{entry.totalBags! > 1 ? 's' : ''}
                                </span>
                              )}
                              <span className="text-[8px] font-bold opacity-40">{entry.time}</span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default DashboardModal;
