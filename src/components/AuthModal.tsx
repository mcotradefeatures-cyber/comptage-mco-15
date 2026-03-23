import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string, user: any) => void;
  theme: 'color' | 'day' | 'night';
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess, theme }) => {
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | React.ReactNode>('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      
      // Bypass OTP for special admin
      if (cleanEmail === 'mco.tradefeatures@gmail.com') {
        if (companyName !== 'dinosoresecret' || mobile !== '2204@') {
          throw new Error('Informations secrètes incorrectes pour cet administrateur');
        }
        const response = await fetch('/api/auth/admin-bypass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, companyName, mobile }),
        });
        
        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (e) {
          throw new Error('Le serveur a renvoyé une réponse invalide. Veuillez réessayer.');
        }

        if (!response.ok) throw new Error(result.error || 'Erreur bypass admin');
        onSuccess(result.token, result.user);
        onClose();
        return;
      }

      const { error: sbError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin,
        },
      });

      if (sbError) throw sbError;
      setOtpSent(true);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'envoi du code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanCode = otpCode.trim();
      
      let verifyResult = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: 'email',
      });

      if (verifyResult.error) {
        verifyResult = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanCode,
          type: 'magiclink',
        });
      }

      if (verifyResult.error) {
        verifyResult = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanCode,
          type: 'signup',
        });
      }

      if (verifyResult.error) throw verifyResult.error;
      
      const { data } = verifyResult;
      if (!data.session) throw new Error('Session non créée');

      const response = await fetch('/api/auth/supabase-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          access_token: data.session.access_token,
          registrationData: {
            companyName,
            mobile
          }
        }),
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        throw new Error('Le serveur a renvoyé une réponse invalide. Veuillez réessayer.');
      }

      if (!response.ok) throw new Error(result.error || 'Erreur de synchronisation');

      onSuccess(result.token, result.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Code invalide ou expiré');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    if (otpSent) return handleVerifyOtp(e);
    return handleSendOtp(e);
  };

  const bgClass = theme === 'night' ? 'bg-[#1a1a1a] text-white border-white/10' : 'bg-white text-black border-black/5';
  const inputClass = theme === 'night' ? 'bg-[#333] border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-black';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className={`w-full max-w-md p-5 sm:p-8 rounded-2xl sm:rounded-3xl shadow-2xl border my-auto ${bgClass}`}>
          <div className="flex justify-between items-center mb-4 sm:mb-6">
          <h2 className="text-xl font-bold uppercase tracking-tight">
            {otpSent ? 'Vérifier le code' : 'Connexion'}
          </h2>
          <button onClick={onClose} className="opacity-50 hover:opacity-100 transition-opacity">
            <i className="fa-solid fa-xmark text-xl"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-xs font-bold bg-red-500/10 text-red-500 rounded-lg border border-red-500/20">
              {error}
            </div>
          )}

          {otpSent ? (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 mb-4">
                <p className="text-[10px] font-bold opacity-60 uppercase text-center">
                  Code envoyé à <span className="text-blue-500">{email.toLowerCase()}</span>
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Code reçu par email</label>
                <input
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${inputClass}`}
                  placeholder="123456"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-3 rounded-xl font-bold text-sm uppercase tracking-widest transition-all active:scale-95 shadow-lg ${
                  loading ? 'opacity-50 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {loading ? 'Chargement...' : 'Vérifier'}
              </button>
              <button
                type="button"
                onClick={() => setOtpSent(false)}
                className="w-full text-[10px] font-bold text-blue-500 uppercase tracking-tight hover:underline text-center"
              >
                Changer les informations
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Nom / Société</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${inputClass}`}
                    placeholder="Ex: Jean"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Numéro Mobile</label>
                  <input
                    type="tel"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${inputClass}`}
                    placeholder="034 00 000 00"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Email</label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value.toLowerCase())}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${inputClass}`}
                      placeholder="votre@email.com"
                      required
                    />
                  </div>
                  <div className="w-1/3">
                    <button
                      type="submit"
                      disabled={loading}
                      className={`w-full h-full py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all active:scale-95 shadow-lg ${
                        loading ? 'opacity-50 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {loading ? '...' : 'Envoyer'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </form>

        <div className="mt-6 text-center">
          <p className="text-[10px] font-bold opacity-30 uppercase tracking-widest">
            Un code de connexion vous sera envoyé par email
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
