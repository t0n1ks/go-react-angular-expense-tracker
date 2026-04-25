import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { type Category, type Transaction, type TransactionPayload } from '../models/transaction.model';

const API = 'http://localhost:8080/api';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  constructor(private http: HttpClient, private auth: AuthService) {}

  private get opts() {
    return { headers: this.auth.getAuthHeaders() };
  }

  getTransactions() {
    return this.http.get<{ transactions: Transaction[] }>(`${API}/transactions`, this.opts);
  }

  getCategories() {
    return this.http.get<{ categories: Category[] }>(`${API}/categories`, this.opts);
  }

  createTransaction(payload: TransactionPayload) {
    return this.http.post(`${API}/transactions`, payload, this.opts);
  }

  updateTransaction(id: number, payload: TransactionPayload) {
    return this.http.put(`${API}/transactions/${id}`, payload, this.opts);
  }

  deleteTransaction(id: number) {
    return this.http.delete(`${API}/transactions/${id}`, this.opts);
  }
}
