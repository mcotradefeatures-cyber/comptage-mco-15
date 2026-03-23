import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TableData, HistoryEntry } from './types';
import VirtualKeyboard from './components/VirtualKeyboard';
import AuthModal from './components/AuthModal';
import DashboardModal from './components/DashboardModal';
import AdminPage from './components/AdminPage';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { supabase } from './supabaseClient';

const GRID_SIZE = 5;

const createEmptyPage = (): TableData => {
  return Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));
};

type Theme = 'color' | 'day' | 'night';

const App: React.FC = () => {
  const [pages, setPages] = useState<TableData[]>([createEmptyPage()]);
  const [bagsPages, setBagsPages] = useState<TableData[]>([createEmptyPage()]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);
  const [theme, setTheme] = useState<Theme>('color');
  const [isLocked, setIsLocked] = useState(false); 
  const [inputValue, setInputValue] = useState('');
  const [title, setTitle] = useState('Nouveau Comptage');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false);
  
  // Description fields
  const [countNumber, setCountNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientMobile, setClientMobile] = useState('');
  const [transactionType, setTransactionType] = useState<'achat' | 'vente'>('vente');
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [companyName, setCompanyName] = useState('NOM / SOCIÉTÉ');
  const [decimalHandling, setDecimalHandling] = useState<'all' | 'none' | 'threshold'>('all');
  const [bagPrice, setBagPrice] = useState<number>(0);
  const [includeBagPrice, setIncludeBagPrice] = useState<boolean>(false);
  
  // Auth & Sync
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isDashboardModalOpen, setIsDashboardModalOpen] = useState(false);
  const [isAdminPageOpen, setIsAdminPageOpen] = useState(false);
  const [showDemoPopup, setShowDemoPopup] = useState(false);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const isRemoteUpdate = useRef(false);

  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setIsAuthModalOpen(false); // Close modal on successful sign in
        
        // Check for pending registration data in localStorage
        const pendingData = localStorage.getItem('count_pro_pending_reg');
        let registrationData = undefined;
        if (pendingData) {
          try {
            registrationData = JSON.parse(pendingData);
          } catch (e) {
            console.error('Failed to parse pending registration data:', e);
          }
          localStorage.removeItem('count_pro_pending_reg');
        }

        try {
          const response = await fetch('/api/auth/supabase-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              access_token: session.access_token,
              registrationData 
            }),
          });
          
          const text = await response.text();
          let result;
          try {
            result = JSON.parse(text);
          } catch (e) {
            console.error('Failed to parse response as JSON. Response text:', text);
            throw e;
          }

          if (response.ok) {
            setToken(result.token);
            setUser(result.user);
            localStorage.setItem('count_pro_auth', JSON.stringify({ token: result.token, user: result.user }));
            
            // Force unlock if user is valid
            if (result.user.role === 'admin' || (result.user.subscription_end && result.user.subscription_end > Date.now())) {
              setIsAppLocked(false);
            }
          } else {
            console.error('Auth sync failed with status:', response.status, result);
          }
        } catch (err) {
          console.error('Auth sync error:', err);
        }
      } else if (event === 'SIGNED_OUT') {
        handleLogout();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const savedAuth = localStorage.getItem('count_pro_auth');
    if (savedAuth) {
      const { token, user } = JSON.parse(savedAuth);
      setToken(token);
      setUser(user);
      if (user.company_name) setCompanyName(user.company_name);
      setIsDashboardModalOpen(true); // Open dashboard by default for the user
      
      // Check lock status based on subscription
      if (user.role !== 'admin') {
        const subEnd = user.subscription_end || 0;
        const isExpired = subEnd <= Date.now();
        setIsAppLocked(isExpired);
        if (isExpired) setShowDemoPopup(true);
      } else {
        setIsAppLocked(false);
      }
    }
  }, []);

  const syncState = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN && token && !isRemoteUpdate.current) {
      socketRef.current.send(JSON.stringify({
        type: 'update',
        state: {
          pages,
          title,
          history,
          countNumber,
          clientName,
          clientMobile,
          transactionType,
          unitPrice,
          decimalHandling,
          bagPrice,
          includeBagPrice
        }
      }));
    }
  }, [pages, title, history, countNumber, clientName, clientMobile, transactionType, unitPrice, decimalHandling, bagPrice, includeBagPrice, token]);

  useEffect(() => {
    if (token) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}`);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'auth', token }));
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error') {
          alert(data.message);
          if (data.message.includes('Limite')) {
            handleLogout();
          }
          return;
        }
        if (data.type === 'user_update') {
          setUser(data.user);
          const updatedAuth = JSON.parse(localStorage.getItem('count_pro_auth') || '{}');
          updatedAuth.user = data.user;
          localStorage.setItem('count_pro_auth', JSON.stringify(updatedAuth));
          return;
        }
        if (data.type === 'init' || data.type === 'update') {
          isRemoteUpdate.current = true;
          const { state } = data;
          setPages(state.pages);
          setTitle(state.title);
          setHistory(state.history);
          setCountNumber(state.countNumber);
          setClientName(state.clientName);
          setClientMobile(state.clientMobile);
          setTransactionType(state.transactionType);
          setUnitPrice(state.unitPrice);
          setDecimalHandling(state.decimalHandling);
          if (state.bagPrice !== undefined) setBagPrice(state.bagPrice);
          if (state.includeBagPrice !== undefined) setIncludeBagPrice(state.includeBagPrice);
          setTimeout(() => { isRemoteUpdate.current = false; }, 100);
        }
      };

      return () => socket.close();
    }
  }, [token]);

  useEffect(() => {
    if (token) syncState();
  }, [pages, title, history, countNumber, clientName, clientMobile, transactionType, unitPrice, decimalHandling, bagPrice, includeBagPrice, token, syncState]);

  useEffect(() => {
    const savedHistory = localStorage.getItem('count_pro_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));
    
    const savedTheme = localStorage.getItem('count_pro_theme') as Theme;
    if (savedTheme) setTheme(savedTheme || 'color');
  }, []);

  useEffect(() => {
    localStorage.setItem('count_pro_theme', theme);
    const bgColors = {
      color: '#ffffff',
      day: '#ffffff',
      night: '#1a1a1a'
    };
    document.body.style.backgroundColor = bgColors[theme];
    document.body.style.color = theme === 'night' ? '#ffffff' : '#000000';
  }, [theme]);

  const [mvolaPhone, setMvolaPhone] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);
  const [currentSubPrice, setCurrentSubPrice] = useState<number>(200);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.prices) {
          setCurrentSubPrice(user?.account_type === 'team' ? data.prices.team : data.prices.personal);
        }
      })
      .catch(err => console.error('Erreur prix:', err));
  }, [user?.account_type]);

  const handleMVolaPayment = async () => {
    if (!mvolaPhone) {
      alert('Veuillez entrer votre numéro MVola');
      return;
    }

    // Check for admin number
    const normalizedPhone = mvolaPhone.replace(/\s/g, '');
    if (normalizedPhone === '0347685594') {
      alert('Le contact admin ne peut pas payer pour vous, entrer votre numéro MVola');
      return;
    }

    setPaymentLoading(true);
    setPaymentMessage('');
    try {
      const response = await fetch('/api/payment/mvola/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ phoneNumber: mvolaPhone })
      });
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Le serveur de paiement ne répond pas correctement. Veuillez réessayer.');
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPaymentMessage(data.message);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setPaymentLoading(false);
    }
  };

  useEffect(() => {
    const checkLock = () => {
      if (!user) {
        setIsAppLocked(true);
        return;
      }
      if (user.role === 'admin') {
        setIsAppLocked(false);
        return;
      }
      const subEnd = user.subscription_end || 0;
      const isExpired = subEnd <= Date.now();
      
      setIsAppLocked((prev) => {
        if (!prev && isExpired) {
          setShowDemoPopup(true);
        }
        return isExpired;
      });
    };

    checkLock();
    const interval = setInterval(checkLock, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [user]);

  const handleCompanyNameBlur = async () => {
    if (!token || !user) return;
    
    // Optimistic update
    const updatedUser = { ...user, company_name: companyName };
    setUser(updatedUser);
    localStorage.setItem('count_pro_auth', JSON.stringify({ token, user: updatedUser }));

    try {
      const response = await fetch('/api/user/update-company-name', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ companyName })
      });
      if (!response.ok) {
        // Revert on error
        setUser(user);
        localStorage.setItem('count_pro_auth', JSON.stringify({ token, user }));
      }
    } catch (err) {
      console.error('Erreur mise à jour nom société:', err);
      // Revert on error
      setUser(user);
      localStorage.setItem('count_pro_auth', JSON.stringify({ token, user }));
    }
  };

  const handleAuthSuccess = (token: string, user: any) => {
    setToken(token);
    setUser(user);
    localStorage.setItem('count_pro_auth', JSON.stringify({ token, user }));
    if (user.company_name) setCompanyName(user.company_name);
    
    // Auto unlock logic
    const subEnd = user.subscription_end || 0;
    const isSubscribed = subEnd > Date.now();
    if (user.role === 'admin' || isSubscribed) {
      setIsAppLocked(false);
      setShowDemoPopup(false);
    }
  };

  const handleLogout = async () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('count_pro_auth');
    socketRef.current?.close();
    await supabase.auth.signOut();
  };

  const cycleTheme = () => {
    setTheme(prev => {
      if (prev === 'color') return 'day';
      if (prev === 'day') return 'night';
      return 'color';
    });
  };

  const formatNum = (num: number) => {
    if (isNaN(num)) return 0;
    return Math.round(num * 1000) / 1000;
  };

  const formatDisplay = (num: number) => {
    if (num === 0) return "0";
    const val = Math.round(num * 1000) / 1000;
    const parts = val.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return parts.join(',');
  };

  const formatCurrency = (num: number) => {
    const rounded = Math.round(num);
    return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " Ar";
  };

  const getEffectiveValue = useCallback((val: number) => {
    if (decimalHandling === 'none') return Math.floor(val);
    if (decimalHandling === 'threshold') {
      const decimal = val - Math.floor(val);
      // Use a small epsilon for float comparison if needed, but 0.6 is simple
      return decimal >= 0.6 ? val : Math.floor(val);
    }
    return val;
  }, [decimalHandling]);

  const globalTotal = formatNum(pages.reduce((acc, page) => {
    return acc + page.reduce((pAcc, row) => pAcc + row.reduce((rAcc, val) => rAcc + getEffectiveValue(val), 0), 0);
  }, 0));

  const globalTotalBags = bagsPages.reduce((acc, page) => {
    return acc + page.reduce((pAcc, row) => pAcc + row.reduce((rAcc, val) => rAcc + val, 0), 0);
  }, 0);

  const saveToHistory = useCallback(() => {
    const total = globalTotal;
    
    if (total === 0 && pages.length === 1) return;

    const now = new Date();
    const newEntry: HistoryEntry = {
      id: Date.now().toString(),
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: title || 'Sans titre',
      pages: JSON.parse(JSON.stringify(pages)),
      bagsPages: JSON.parse(JSON.stringify(bagsPages)),
      total: total,
      totalBags: globalTotalBags,
      countNumber,
      clientName,
      clientMobile,
      transactionType,
      unitPrice,
      companyName,
      decimalHandling,
      bagPrice,
      includeBagPrice
    };

    const newHistory = [newEntry, ...history].slice(0, 50);
    setHistory(newHistory);
    localStorage.setItem('count_pro_history', JSON.stringify(newHistory));
  }, [pages, bagsPages, title, history, globalTotal, globalTotalBags, countNumber, clientName, clientMobile, transactionType, unitPrice, companyName, decimalHandling, bagPrice, includeBagPrice]);

  const loadFromHistory = (entry: HistoryEntry) => {
    setPages(JSON.parse(JSON.stringify(entry.pages)));
    setBagsPages(entry.bagsPages ? JSON.parse(JSON.stringify(entry.bagsPages)) : [createEmptyPage()]);
    setTitle(entry.title);
    setCountNumber(entry.countNumber || '');
    setClientName(entry.clientName || '');
    setClientMobile(entry.clientMobile || '');
    setTransactionType(entry.transactionType || 'vente');
    setUnitPrice(entry.unitPrice || 0);
    setCompanyName(entry.companyName || 'NOM / SOCIÉTÉ');
    setDecimalHandling(entry.decimalHandling || 'all');
    setBagPrice(entry.bagPrice || 0);
    setIncludeBagPrice(entry.includeBagPrice || false);
    setCurrentIndex(0);
    setRow(0);
    setCol(0);
    setShowHistory(false);
    setIsLocked(false); 
  };

  const deleteFromHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newHistory = history.filter(h => h.id !== id);
    setHistory(newHistory);
    localStorage.setItem('count_pro_history', JSON.stringify(newHistory));
  };

  const renameHistoryEntry = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const entry = history.find(h => h.id === id);
    if (!entry) return;
    const newTitle = window.prompt("Nouveau titre :", entry.title);
    if (newTitle !== null && newTitle.trim() !== "") {
      const newHistory = history.map(h => h.id === id ? { ...h, title: newTitle.trim() } : h);
      setHistory(newHistory);
      localStorage.setItem('count_pro_history', JSON.stringify(newHistory));
    }
  };

  const getColTotals = (page: TableData) => {
    const totals = Array(GRID_SIZE).fill(0);
    for (let c = 0; c < GRID_SIZE; c++) {
      for (let r = 0; r < GRID_SIZE; r++) {
        totals[c] += getEffectiveValue(page[r][c] || 0);
      }
    }
    return totals.map(formatNum);
  };

  const addValue = useCallback((bags: number = 0) => {
    if (isLocked || isAppLocked) {
      if (!user) setIsAuthModalOpen(true);
      else if (isAppLocked) setShowDemoPopup(true);
      return;
    }

    let raw = inputValue.replace(',', '.');
    if (raw === '.' || raw === '') return;
    
    const value = parseFloat(raw);
    if (isNaN(value)) return;

    setPages(prevPages => {
      const newPages = [...prevPages];
      const currentPage = [...newPages[currentIndex]];
      currentPage[row] = [...currentPage[row]];
      currentPage[row][col] = value;
      newPages[currentIndex] = currentPage;
      return newPages;
    });

    setBagsPages(prevBagsPages => {
      const newBagsPages = [...prevBagsPages];
      // Ensure the page exists
      if (!newBagsPages[currentIndex]) {
        newBagsPages[currentIndex] = createEmptyPage();
      }
      const currentBagsPage = [...newBagsPages[currentIndex]];
      currentBagsPage[row] = [...currentBagsPage[row]];
      currentBagsPage[row][col] = bags;
      newBagsPages[currentIndex] = currentBagsPage;
      return newBagsPages;
    });

    setInputValue('');

    let nextRow = row + 1;
    let nextCol = col;
    let nextIndex = currentIndex;

    if (nextRow === GRID_SIZE) {
      nextRow = 0;
      nextCol = col + 1;
    }

    if (nextCol === GRID_SIZE) {
      nextCol = 0;
      nextRow = 0;
      nextIndex = currentIndex + 1;
      if (pages.length <= nextIndex) {
        setPages(prev => [...prev, createEmptyPage()]);
        setBagsPages(prev => [...prev, createEmptyPage()]);
      }
    }

    setRow(nextRow);
    setCol(nextCol);
    setCurrentIndex(nextIndex);
  }, [inputValue, row, col, currentIndex, pages.length, isLocked, isAppLocked, user]);

  const resetAll = () => {
    if (globalTotal === 0 && pages.length === 1 && title === 'Nouveau Comptage') return;
    saveToHistory();
    setPages([createEmptyPage()]);
    setBagsPages([createEmptyPage()]);
    setCurrentIndex(0);
    setRow(0);
    setCol(0);
    setInputValue('');
    setTitle('Nouveau Comptage');
    setCountNumber('');
    setClientName('');
    setClientMobile('');
    setUnitPrice(0);
    setIsLocked(false); 
  };

  const generatePDF = (action: 'download' | 'print' = 'download') => {
    const doc = new jsPDF();
    const totalPrice = unitPrice * globalTotal;
    const totalWithBags = totalPrice + (bagPrice * globalTotalBags);
    
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(companyName, 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Facture / Reçu: ${title} #${countNumber}`, 20, 40);
    
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 50);
    
    doc.line(20, 55, 190, 55);
    
    doc.text(`Client: ${clientName}`, 20, 70);
    doc.text(`Mobile: ${clientMobile}`, 20, 80);
    
    doc.line(20, 85, 190, 85);
    
    doc.text(`Type: ${transactionType.toUpperCase()}`, 20, 100);
    doc.text(`Quantité Totale: ${globalTotal}`, 20, 110);
    doc.text(`Prix Unitaire: ${unitPrice > 0 ? formatCurrency(unitPrice) : ''}`, 20, 120);
    
    doc.setFont('helvetica', 'bold');
    doc.text(`PRIX TOTAL: ${totalPrice > 0 ? formatCurrency(totalPrice) : ''}`, 20, 140);

    let currentY = 150;

    if (includeBagPrice && bagPrice > 0) {
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Sacs: ${globalTotalBags}`, 20, 150);
      doc.text(`Prix du sac: ${formatCurrency(bagPrice)}`, 20, 160);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(16, 185, 129); // emerald-500
      doc.text(`TOTAL AVEC SACS: ${formatCurrency(totalWithBags)}`, 20, 175);
      doc.setTextColor(0, 0, 0); // reset to black
      currentY = 190;
    }
    
    // Add tables for each page
    let tableCol = 0; // 0 for left, 1 for right
    let maxYInRow = 0;
    
    pages.forEach((page, pIdx) => {
      // Check if page has data
      const hasData = page.some(row => row.some(val => val !== 0));
      if (!hasData && pIdx > 0) return;

      if (currentY > 240) {
        doc.addPage();
        currentY = 20;
        tableCol = 0;
        maxYInRow = 0;
      }

      const tableData = page.map(row => row.map(val => val === 0 ? '' : formatDisplay(getEffectiveValue(val))));
      const colTotals = getColTotals(page);
      tableData.push(colTotals.map(t => formatDisplay(t)));

      const marginX = tableCol === 0 ? 20 : 110;

      autoTable(doc, {
        startY: currentY,
        body: tableData,
        theme: 'grid',
        margin: { left: marginX },
        tableWidth: 80,
        styles: { fontSize: 10, cellPadding: 2 },
        didParseCell: (data) => {
          if (data.row.index === 5) { // Total row
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [240, 240, 240];
          }
        }
      });

      const finalY = (doc as any).lastAutoTable.finalY;
      maxYInRow = Math.max(maxYInRow, finalY);

      if (tableCol === 1) {
        currentY = maxYInRow + 10;
        tableCol = 0;
        maxYInRow = 0;
      } else {
        tableCol = 1;
      }
    });
    
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Page ${i} sur ${pageCount}`, 105, 285, { align: 'center' });
      doc.text("Généré par Comptage Pro", 105, 290, { align: 'center' });
    }
    
    if (action === 'download') {
      doc.save(`Facture_${title}_${countNumber}.pdf`);
    } else {
      doc.autoPrint();
      window.open(doc.output('bloburl'), '_blank');
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartX.current;
    if (diff > 50 && currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    } else if (diff < -50 && currentIndex < pages.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
    touchStartX.current = null;
  };

  const getThemeClasses = () => {
    const isNight = theme === 'night';
    const isDay = theme === 'day';
    const isColor = theme === 'color';

    return {
      container: isNight ? 'text-white' : 'text-[#000000]',
      headerBg: isNight ? 'bg-[#2a2a2a] border-[#333]' : (isColor ? 'bg-white border-[#e0e0e0]' : 'bg-white border-[#666666]'),
      tableBg: isNight ? 'bg-[#2a2a2a] border-[#333]' : (isColor ? 'bg-[#f8f9fa] border-[#e0e0e0]' : 'bg-white border-[#666666]'),
      cellBg: isNight ? 'bg-[#333333] text-white' : 'bg-white text-[#000000]',
      cellBorder: isNight ? 'border-[#444]' : (isColor ? 'border-[#e0e0e0]' : 'border-[#666666]'),
      cellActive: isNight ? 'ring-white/30' : 'ring-[#000000]/20',
      footerBg: isNight ? 'bg-white text-[#1a1a1a] border-white' : (isColor ? 'bg-[#1976d2] text-white border-[#1976d2]' : 'bg-[#000000] text-white border-[#000000]'),
      btnTheme: isNight ? 'bg-[#333] text-white border-[#444]' : (isColor ? 'bg-[#f2f2f2] text-[#1976d2] border-[#e0e0e0]' : 'bg-white text-[#000000] border-[#666666]'),
      inputTitle: isNight ? 'text-white' : (isColor ? 'text-[#1976d2]' : 'text-[#000000]'),
      totalLabel: isNight ? 'text-[#000000]/60' : 'text-white/60',
      dots: isNight ? 'bg-white' : (isColor ? 'bg-[#1976d2]' : 'bg-[#000000]'),
      inputBox: isNight ? 'bg-[#333] text-white border-[#444]' : (isColor ? 'bg-white text-[#1976d2] border-white' : 'bg-white text-[#000000] border-white'),
      inputBoxLabel: isNight ? 'text-white/50' : (isColor ? 'text-[#1976d2]/60' : 'text-[#000000]/60'),
      signature: isNight ? 'text-[#000000]/40' : 'text-white/40'
    };
  };

  const classes = getThemeClasses();

  return (
    <div className={`fixed inset-0 h-full w-full flex flex-col overflow-hidden select-none p-2 transition-colors duration-300 ${classes.container}`}>
      
      {/* AUTH MODAL */}
      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
        onSuccess={handleAuthSuccess}
        theme={theme}
      />

      {/* DASHBOARD MODAL */}
      {user && (
        <DashboardModal 
          isOpen={isDashboardModalOpen}
          onClose={() => setIsDashboardModalOpen(false)}
          user={user}
          token={token}
          history={history}
          onLoadEntry={loadFromHistory}
          onLogout={handleLogout}
          onPay={() => {
            setIsDashboardModalOpen(false);
            setShowDemoPopup(true);
          }}
          onOpenAdmin={() => {
            setIsDashboardModalOpen(false);
            setIsAdminPageOpen(true);
          }}
          theme={theme}
          currentSubPrice={currentSubPrice}
          companyName={companyName}
        />
      )}

      {/* ADMIN PAGE */}
      {isAdminPageOpen && token && (
        <AdminPage 
          token={token} 
          onClose={() => setIsAdminPageOpen(false)} 
          theme={theme} 
        />
      )}

      {/* DEMO POPUP */}
      {showDemoPopup && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className={`w-full max-w-sm p-6 sm:p-8 rounded-3xl shadow-2xl border-2 border-blue-500 text-center relative ${theme === 'night' ? 'bg-[#1a1a1a] text-white' : 'bg-white text-black'}`}>
            <button 
              onClick={() => setShowDemoPopup(false)} 
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-black text-xl font-bold active:scale-90 transition-transform"
            >
              ×
            </button>
            <div className="w-16 h-16 bg-blue-500/20 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <i className="fa-solid fa-circle-info text-3xl"></i>
            </div>
            <p className="text-sm font-bold opacity-70 mb-8 leading-relaxed">
              Bonjour,<br />
              si l'app vous aide, vous devez payer <span className="text-blue-500">{currentSubPrice.toLocaleString()} Ar</span> pour un (1) mois.
            </p>
            
            <div className="relative">
              <AnimatePresence>
                {showTooltip && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-0 right-0 mb-4 p-4 bg-[#3c3c3b]/60 backdrop-blur-md text-white text-[11px] font-bold rounded-2xl shadow-xl z-50 leading-relaxed text-center border border-white/10"
                  >
                    <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-[#3c3c3b]/60 backdrop-blur-md rotate-45 border-r border-b border-white/10" />
                    Pour payer, vous devez mettre votre numéro MVola de paiement, cliquer sur PAYER, et attendre quelques instants. Vous recevrez une demande de validation sur votre mobile.
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="p-2 bg-[#ffdd00] rounded-2xl border border-[#ffdd00] mb-6 flex items-center gap-3 shadow-sm relative z-10">
                <div className="w-16 h-10 flex items-center justify-center shrink-0 overflow-hidden ml-1">
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
                        parent.innerHTML = '<span class="text-[#006935] font-black italic text-sm">MVola</span>';
                      }
                    }}
                  />
                </div>
                
                <input 
                  type="tel"
                  placeholder="034 00 000 00"
                  value={mvolaPhone}
                  onChange={(e) => setMvolaPhone(e.target.value)}
                  onFocus={() => setShowTooltip(true)}
                  onBlur={() => setShowTooltip(false)}
                  className="w-32 p-1 bg-transparent border-none outline-none font-black text-sm text-[#000] placeholder:text-[#000]/30"
                />
                
                <button 
                  onClick={handleMVolaPayment}
                  disabled={paymentLoading}
                  className={`ml-auto h-9 px-4 rounded-xl bg-[#006935] text-white font-black text-[10px] uppercase tracking-wider flex items-center justify-center transition-all shadow-md ${paymentLoading ? 'opacity-50' : 'active:scale-95 hover:bg-[#005a2d]'}`}
                >
                  {paymentLoading ? (
                    <i className="fa-solid fa-circle-notch animate-spin"></i>
                  ) : (
                    "Payer"
                  )}
                </button>
              </div>
            </div>

            <div className="mb-4">
              {paymentMessage && (
                <div className="p-4 bg-[#006935]/10 text-[#006935] rounded-2xl text-xs font-bold leading-relaxed mb-2">
                  {paymentMessage}
                </div>
              )}
            </div>

            <div className="mt-8 pt-4 border-t border-gray-100/10 text-center space-y-1">
              <p className="text-[9px] font-bold text-[#3c3c3b] opacity-40 uppercase tracking-widest">
                Admin: 2204@
              </p>
              <p className="text-[8px] font-bold text-[#3c3c3b] opacity-30 lowercase tracking-tight">
                mco.tradefeatures@gmail.com
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[500px] mx-auto w-full flex flex-col h-full gap-2 relative">
        
        {/* HEADER */}
        {!isDescriptionOpen && (
          <header className="flex flex-col gap-1 shrink-0 px-1 sm:px-0">
            <div className="flex gap-2 h-[7vh] min-h-[48px] max-h-[60px]">
              <div className={`flex-1 flex items-center px-3 sm:px-4 rounded-xl border transition-colors duration-300 ${classes.headerBg} gap-2 sm:gap-3`}>
                <button 
                  onClick={() => user ? setIsDashboardModalOpen(true) : setIsAuthModalOpen(true)}
                  className={`w-3 h-3 rounded-full shrink-0 transition-all shadow-[0_0_8px_rgba(34,197,94,0.4)] ${user ? 'bg-green-500' : 'bg-gray-300 animate-pulse'}`}
                  title={user ? `Connecté en tant que ${user.company_name || user.email.toLowerCase()}` : 'Se connecter'}
                />
                <div className="flex-1 flex flex-col min-w-0">
                  <input 
                    type="text" 
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)}
                    className={`w-full bg-transparent border-none outline-none text-sm font-bold uppercase tracking-tight truncate ${classes.inputTitle}`}
                    placeholder="TITRE"
                  />
                  {user && (
                    <span className="text-[8px] font-bold opacity-40 truncate -mt-1 uppercase tracking-tight">
                      {companyName !== 'NOM / SOCIÉTÉ' ? companyName : (user.company_name || user.email.toLowerCase())}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 sm:gap-1.5 shrink-0">
                <button onClick={resetAll} className={`w-10 sm:w-11 h-full rounded-xl flex items-center justify-center font-bold text-lg active:scale-95 transition-all shadow-sm border ${theme === 'color' ? 'bg-[#1976d2] text-white border-transparent' : 'bg-[#000000] text-white border-transparent'}`}>×</button>
                
                <button 
                  onClick={cycleTheme} 
                  className={`w-10 sm:w-11 h-full rounded-xl flex items-center justify-center text-sm active:scale-95 transition-all shadow-sm border ${classes.btnTheme}`}
                >
                  <i className={`fa-solid ${theme === 'color' ? 'fa-palette text-[#1976d2]' : theme === 'day' ? 'fa-sun text-[#000000]' : 'fa-moon text-white'} text-base`}></i>
                </button>

                <button 
                  onClick={() => {
                    if (isAppLocked) {
                      if (!user) setIsAuthModalOpen(true);
                      else setShowDemoPopup(true);
                      return;
                    }
                    setIsLocked(!isLocked);
                  }} 
                  className={`w-10 sm:w-11 h-full rounded-xl flex items-center justify-center text-sm active:scale-95 transition-all shadow-sm border ${!(isLocked || isAppLocked) 
                    ? (theme === 'night' ? 'bg-white text-[#1a1a1a] border-transparent' : (theme === 'day' ? 'bg-black text-white border-transparent' : 'bg-blue-50 text-[#1976d2] border-[#1976d2]')) 
                    : (theme === 'night' ? 'bg-transparent text-white/20 border-white/20' : 'bg-transparent text-[#000000]/20 border-[#666666]')
                  }`}
                >
                  <i className={`fa-solid ${(isLocked || isAppLocked) ? 'fa-lock' : 'fa-unlock'}`}></i>
                </button>
              </div>
            </div>
          </header>
        )}

        {/* TABLEAU */}
        <main className="flex-1 min-h-0 w-full relative overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {isDescriptionOpen ? (
            <div className={`absolute inset-0 z-20 flex flex-col p-4 animate-in fade-in duration-300 ${theme === 'night' ? 'bg-[#1a1a1a] text-white' : 'bg-white text-[#000000]'}`}>
              <div className="flex justify-between items-center mb-4 px-2">
                <h2 className="text-sm font-black uppercase tracking-tighter">Description</h2>
                <button onClick={() => setIsDescriptionOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 text-black text-sm font-bold active:scale-90 transition-transform">×</button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 px-2 custom-scrollbar pb-4">
                {/* ROW 1: NOM DU COMPTAGE, NUMERO DU COMPTAGE */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Nom du Comptage</label>
                    <input 
                      type="text" 
                      value={title} 
                      onChange={(e) => setTitle(e.target.value)}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                      placeholder="Titre"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Numéro du Comptage</label>
                    <input 
                      type="text" 
                      value={countNumber} 
                      onChange={(e) => setCountNumber(e.target.value)}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                      placeholder="#001"
                    />
                  </div>
                </div>

                {/* ROW 2: SOCIÉTÉ / NOM DU CLIENT, NUMERO DU CLIENT */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Société / Nom du Client</label>
                    <input 
                      type="text" 
                      value={clientName} 
                      onChange={(e) => setClientName(e.target.value)}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                      placeholder="Client"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Numéro du Client</label>
                    <input 
                      type="tel" 
                      value={clientMobile} 
                      onChange={(e) => setClientMobile(e.target.value)}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                      placeholder="030 00 000 00"
                    />
                  </div>
                </div>

                {/* ROW 3: MA SOCIÉTÉ, TYPE DE TRANSACTION */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Ma Société</label>
                    <input 
                      type="text" 
                      value={companyName} 
                      onChange={(e) => setCompanyName(e.target.value)}
                      onBlur={handleCompanyNameBlur}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold text-blue-500 ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444]' : 'bg-gray-50 border-gray-200'}`}
                      placeholder="MA SOCIÉTÉ"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Type de Transaction</label>
                    <select 
                      value={transactionType}
                      onChange={(e) => setTransactionType(e.target.value as 'achat' | 'vente')}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold appearance-none cursor-pointer ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                    >
                      <option value="achat">ACHAT</option>
                      <option value="vente">VENTE</option>
                    </select>
                  </div>
                </div>

                {/* ROW 4: PRIX UNITAIRE, PRIX DU SAC */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Prix Unitaire (/kg)</label>
                    <input 
                      type="number" 
                      value={unitPrice || ''} 
                      onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Prix du sac</label>
                    <input 
                      type="number" 
                      value={bagPrice || ''} 
                      onChange={(e) => setBagPrice(parseFloat(e.target.value) || 0)}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* ROW 5: GESTION DES VIRGULES, INCLURE PRIX SACS */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase opacity-50 ml-1">Gestion des Virgules</label>
                    <select 
                      value={decimalHandling}
                      onChange={(e) => setDecimalHandling(e.target.value as 'all' | 'none' | 'threshold')}
                      className={`w-full p-3 rounded-xl border outline-none text-sm font-bold appearance-none cursor-pointer ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444] text-white' : 'bg-gray-50 border-gray-200 text-[#000000]'}`}
                    >
                      <option value="all">COMPTER LES VIRGULES</option>
                      <option value="none">NE PAS COMPTER</option>
                      <option value="threshold">COMPTER SI &gt; 0,6</option>
                    </select>
                  </div>
                  <div className="space-y-1.5 flex flex-col justify-center mt-2">
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        id="includeBagPrice"
                        checked={includeBagPrice} 
                        onChange={(e) => setIncludeBagPrice(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <label htmlFor="includeBagPrice" className="text-[10px] font-bold uppercase opacity-50 cursor-pointer">
                        Inclure le prix des sacs
                      </label>
                    </div>
                  </div>
                </div>

                {/* TOTALS & ACTIONS */}
                <div className={`mt-6 p-4 rounded-xl border shadow-sm ${theme === 'night' ? 'bg-[#2a2a2a] border-[#444]' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex justify-between items-center mb-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold uppercase opacity-50">Comptes</span>
                      <span className="text-lg font-black">{formatDisplay(globalTotal)}</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold uppercase opacity-50">Sacs</span>
                      <span className="text-lg font-black">{formatCurrency(bagPrice * globalTotalBags)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-bold uppercase opacity-50">Prix Total</span>
                      <span className="text-lg font-black text-blue-500">{formatCurrency(unitPrice * globalTotal)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => generatePDF('download')}
                      className="flex-1 py-3 rounded-xl bg-red-50 text-red-500 font-bold text-xs flex items-center justify-center gap-2 border border-red-100 active:scale-95 transition-transform"
                    >
                      <i className="fa-solid fa-file-pdf"></i> PDF
                    </button>
                    <button 
                      onClick={() => generatePDF('print')}
                      className={`flex-1 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border active:scale-95 transition-transform ${theme === 'night' ? 'bg-[#333] text-white border-[#444]' : 'bg-white text-gray-700 border-gray-200'}`}
                    >
                      <i className="fa-solid fa-print"></i> Imprimer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : showHistory ? (
            <div className={`absolute inset-0 z-20 flex flex-col p-2 animate-in fade-in duration-300 ${theme === 'night' ? 'bg-[#1a1a1a] text-white' : 'bg-white text-[#000000]'}`}>
              <div className="flex justify-between items-center mb-2 px-2">
                <h2 className="text-sm font-black uppercase tracking-tighter">Historique</h2>
                <button onClick={() => setShowHistory(false)} className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 text-black text-sm font-bold active:scale-90 transition-transform">×</button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pb-2 px-1 custom-scrollbar">
                {history.length === 0 ? (
                  <div className="text-center opacity-30 py-10 text-xs uppercase tracking-widest">Vide</div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} onClick={() => loadFromHistory(item)} className={`p-2 rounded-xl border transition-all active:scale-[0.98] cursor-pointer relative shadow-sm ${theme === 'night' ? 'bg-[#2a2a2a] border-[#333]' : 'bg-[#f9f9f9] border-[#e0e0e0]'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[9px] font-bold opacity-40 uppercase tracking-widest">{item.date} • {item.time}</span>
                        <div className="flex gap-3">
                          <button onClick={(e) => renameHistoryEntry(item.id, e)} className="text-black/30 p-1 active:scale-125 transition-transform"><i className="fa-solid fa-pen text-[10px]"></i></button>
                          <button onClick={(e) => deleteFromHistory(item.id, e)} className="text-red-500/30 p-1 active:scale-125 transition-transform"><i className="fa-solid fa-trash-can text-[10px]"></i></button>
                        </div>
                      </div>
                      <div className="font-bold text-xs truncate pr-12">{item.title}</div>
                      <div className="flex items-center justify-between mt-1">
                        <div className="flex items-center gap-2">
                          <div className={`font-black text-sm ${theme === 'night' ? 'text-white' : 'text-[#000000]'}`}>{formatDisplay(item.total)}</div>
                          {(item.totalBags || 0) > 0 && (
                            <div className="text-[10px] font-bold opacity-60 bg-black/5 px-1.5 py-0.5 rounded-md">
                              {item.totalBags} sac{item.totalBags! > 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex slider-transition h-full w-full" style={{ transform: `translateX(-${currentIndex * 100}%)` }}>
              {pages.map((page, pIdx) => (
                <div key={pIdx} className="min-w-full h-full flex flex-col p-0.5">
                  <div className={`flex-1 grid grid-cols-5 grid-rows-6 gap-1 p-1 rounded-xl shadow-sm border transition-all duration-300 ${classes.tableBg} ${(isLocked || isAppLocked) ? 'opacity-80' : 'opacity-100'}`}>
                    {page.map((rowArr, rIdx) => rowArr.map((cell, cIdx) => {
                      const isDecimalCounted = (val: number) => {
                        if (decimalHandling === 'all') return true;
                        if (decimalHandling === 'none') return false;
                        if (decimalHandling === 'threshold') return (val - Math.floor(val)) >= 0.6;
                        return true;
                      };

                      const renderCellValue = (val: number) => {
                        if (val === 0) return '';
                        const v = Math.round(val * 1000) / 1000;
                        const parts = v.toString().split('.');
                        const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
                        const decimalPart = parts[1];
                        
                        if (!decimalPart) return integerPart;
                        
                        return (
                          <>
                            {integerPart}
                            <span className={isDecimalCounted(val) ? '' : 'opacity-30'}>,{decimalPart}</span>
                          </>
                        );
                      };

                      return (
                        <div 
                          key={`${rIdx}-${cIdx}`}
                          onClick={() => { 
                            if (isLocked || isAppLocked) {
                              if (!user) setIsAuthModalOpen(true);
                              else if (isAppLocked) setShowDemoPopup(true);
                              return;
                            }
                            setRow(rIdx); 
                            setCol(cIdx); 
                          }}
                          className={`relative flex items-center justify-center rounded-lg text-lg font-bold transition-all duration-200 h-full w-full border ${classes.cellBg} ${classes.cellBorder} ${!(isLocked || isAppLocked) && pIdx === currentIndex && rIdx === row && cIdx === col ? `ring-2 ${classes.cellActive} ring-inset z-10 scale-105` : ''} ${(isLocked || isAppLocked) ? 'cursor-default opacity-60' : 'cursor-pointer active:scale-95'}`}
                        >
                          {renderCellValue(cell)}
                          {bagsPages[pIdx]?.[rIdx]?.[cIdx] > 0 && (
                            <span className="absolute bottom-0 right-1 text-[9px] opacity-50 font-medium">
                              {bagsPages[pIdx][rIdx][cIdx]}
                            </span>
                          )}
                        </div>
                      );
                    }))}
                    {getColTotals(page).map((total, tIdx) => (
                      <div key={`total-${tIdx}`} className={`flex items-center justify-center rounded-lg text-xs font-black transition-all duration-300 h-full w-full ${theme === 'night' ? 'bg-[#333] text-white' : (theme === 'color' ? 'bg-blue-50 text-[#1976d2]' : 'bg-[#f2f2f2] text-[#000000]')}`}>
                        {formatDisplay(total)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* FOOTER TOTALS */}
        {(!showHistory && !isDescriptionOpen) && (
          <footer className="shrink-0 flex flex-col gap-1.5">
            <div className={`flex items-stretch overflow-hidden rounded-xl shadow-sm border transition-all duration-300 ${classes.footerBg}`}>
              {/* BLOC SAISIE */}
              <div className={`flex-[1.4] flex flex-col justify-center items-center m-1 rounded-lg border shadow-inner transition-all duration-300 ${classes.inputBox}`}>
                <span className={`text-[8px] font-bold uppercase tracking-widest mb-0.5 ${classes.inputBoxLabel}`}>Saisie</span>
                <div className="text-3xl font-black leading-none drop-shadow-sm">{inputValue || <span className="opacity-20 text-2xl">0</span>}</div>
              </div>
              {/* BLOC TOTAL AVEC SIGNATURE DISCRÈTE */}
              <div className="flex-[2] flex flex-col justify-center items-end px-4 py-2 relative">
                <span className={`text-[8px] font-bold uppercase tracking-widest mb-0.5 ${classes.totalLabel}`}>Total Général</span>
                <div className="text-2xl font-black leading-none">{formatDisplay(globalTotal)}</div>
                {/* SIGNATURE DISCRÈTE - STYLE APPLE SUR DEUX LIGNES */}
                <div className={`absolute bottom-0.5 left-3 flex flex-col items-start pointer-events-none transition-opacity duration-300 leading-tight ${classes.signature}`}>
                  <span className="text-2xl font-black tracking-tighter">Mco</span>
                  <span className="text-[7px] font-extralight tracking-[0.2em] opacity-80 -mt-0.5 uppercase">/ 032 90 709 19</span>
                </div>
              </div>
            </div>
          </footer>
        )}

        {/* CLAVIER OU BOUTON HISTORIQUE SEUL */}
        <section className="shrink-0">
          {(!showHistory && !isDescriptionOpen) ? (
            <VirtualKeyboard 
              theme={theme}
              isLocked={isLocked || isAppLocked}
              onKeyPress={(key) => { 
                if (isLocked || isAppLocked) {
                  if (!user) setIsAuthModalOpen(true);
                  else if (isAppLocked) setShowDemoPopup(true);
                  return;
                }
                if (key === '.' && inputValue.includes('.')) return; 
                setInputValue(prev => prev + key); 
              }}
              onClear={() => {
                if (isLocked || isAppLocked) return;
                setInputValue(prev => prev.slice(0, -1));
              }}
              onValidate={addValue}
              onShowHistory={() => setShowHistory(true)}
              totalBags={globalTotalBags}
            />
          ) : showHistory ? (
            <div className="p-1.5">
              <div className="grid grid-cols-4 gap-1.5">
                <button 
                  onClick={() => {
                    setShowHistory(false);
                    setIsDescriptionOpen(true);
                  }}
                  className={`col-start-1 h-[calc(6.5vh-4.5px)] min-h-[33px] max-h-[48px] flex items-center justify-center rounded-xl text-lg font-bold transition-all w-full active:scale-95 cursor-pointer border ${theme === 'night' ? 'bg-[#333] text-white border-[#444]' : (theme === 'day' ? 'bg-white text-[#000000] border-[#666666]' : 'bg-white text-[#2d2d2d] border-[#e0e0e0]')}`}
                >
                  <i className="fa-solid fa-list-ul text-xs"></i>
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default App;