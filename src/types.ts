
export type TableData = number[][];

export interface HistoryEntry {
  id: string;
  date: string;
  time: string;
  title: string;
  pages: TableData[];
  bagsPages?: TableData[]; // Added for bags
  total: number;
  totalBags?: number; // Added for total bags
  bagPrice?: number;
  includeBagPrice?: boolean;
  countNumber?: string;
  clientName?: string;
  clientMobile?: string;
  transactionType?: 'achat' | 'vente';
  unitPrice?: number;
  companyName?: string;
  decimalHandling?: 'all' | 'none' | 'threshold';
}

export interface User {
  id: string;
  email: string;
  password_hash?: string;
  company_name?: string;
  role: 'admin' | 'user';
  account_type: 'personal' | 'team';
  created_at: number;
  last_login?: number;
  subscription_end?: number;
  mobile?: string;
  is_blacklisted?: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface AppState {
  pages: TableData[];
  currentIndex: number;
  row: number;
  col: number;
  globalTotal: number;
  isNightMode: boolean;
  isLocked: boolean;
  inputValue: string;
}
