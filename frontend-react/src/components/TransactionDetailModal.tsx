import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Tag, CalendarDays, Clock, AlignLeft, TrendingUp, TrendingDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../context/SettingsContext";
import "./TransactionDetailModal.css";

interface Category {
  id: number;
  name: string;
}

interface Transaction {
  id: number;
  amount: number;
  date: string;
  created_at?: string;
  description: string;
  type: "expense" | "income";
  income_type?: string;
  category: Category;
}

interface Props {
  tx: Transaction | null;
  onClose: () => void;
}

const TransactionDetailModal: React.FC<Props> = ({ tx, onClose }) => {
  const { t } = useTranslation();
  const { formatAmount } = useSettings();

  useEffect(() => {
    if (!tx) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tx, onClose]);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "";
    }
  };

  const isIncome = tx?.type === "income";

  return (
    <AnimatePresence>
      {tx && (
        <motion.div
          className="txd-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="txd-modal"
            initial={{ opacity: 0, y: 48, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 48, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 380 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="txd-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>

            <div className="txd-header">
              <div className={`txd-amount ${isIncome ? "txd-amount--income" : "txd-amount--expense"}`}>
                {isIncome ? "+" : "−"}{formatAmount(tx.amount)}
              </div>
              <div className={`txd-type-pill ${isIncome ? "txd-type--income" : "txd-type--expense"}`}>
                {isIncome ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {isIncome ? t("transactions.type_income") : t("transactions.type_expense")}
                {isIncome && tx.income_type === "part" && (
                  <span className="txd-income-sub">· {t("transactions.income_type_part")}</span>
                )}
              </div>
            </div>

            <div className="txd-divider" />

            <div className="txd-rows">
              <div className="txd-row">
                <Tag size={15} className="txd-icon" />
                <span className="txd-label">{t("transactions.detail_category")}</span>
                <span className="txd-value">{tx.category?.name || "—"}</span>
              </div>

              <div className="txd-row">
                <CalendarDays size={15} className="txd-icon" />
                <span className="txd-label">{t("transactions.detail_date")}</span>
                <span className="txd-value">{formatDate(tx.date)}</span>
              </div>

              {tx.created_at && (
                <div className="txd-row">
                  <Clock size={15} className="txd-icon" />
                  <span className="txd-label">{t("transactions.detail_added_at")}</span>
                  <span className="txd-value txd-mono">{formatTime(tx.created_at)}</span>
                </div>
              )}

              {tx.description && (
                <div className="txd-row txd-row--desc">
                  <AlignLeft size={15} className="txd-icon" />
                  <span className="txd-label">{t("transactions.detail_note")}</span>
                  <span className="txd-value txd-desc-text">{tx.description}</span>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TransactionDetailModal;
