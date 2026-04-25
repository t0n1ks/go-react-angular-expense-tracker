import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

const API = 'http://localhost:8080/api';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(private http: HttpClient) {}

  login(username: string, password: string) {
    return this.http.post<{ token: string }>(`${API}/login`, { username, password });
  }

  register(username: string, password: string) {
    return this.http.post<{ message: string }>(`${API}/register`, { username, password });
  }

  saveToken(token: string, username: string): void {
    localStorage.setItem('token', token);
    localStorage.setItem('user', username);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getUsername(): string | null {
    return localStorage.getItem('user');
  }

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getAuthHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.getToken() ?? ''}` });
  }
}
