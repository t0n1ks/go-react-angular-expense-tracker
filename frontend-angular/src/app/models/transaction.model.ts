export interface Category {
  id: number;
  name: string;
}

export interface Transaction {
  id: number;
  amount: number;
  date: string;
  description: string;
  type: 'expense' | 'income';
  category: Category;
}

export interface TransactionPayload {
  amount: number;
  date: string;
  description: string;
  category_id: number;
  type: 'expense' | 'income';
}
