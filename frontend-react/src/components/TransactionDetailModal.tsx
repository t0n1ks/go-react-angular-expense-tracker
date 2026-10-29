import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Tag, CalendarDays, Clock, AlignLeft, TrendingUp, TrendingDown, PiggyBank } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";
import { categoryLabel } from "../utils/categoryLabel";
import { isInWindow, txEventTime } from "../utils/categoryWindow";
import { savingsMoveError } from "../utils/savingsMoveError";
import ReturnToBudget from "./ReturnToBudget";
import "./TransactionDetailModal.css";

interface Category {
  id: number;
  name: string;
  translation_key?: string | null;
}

interface Transaction {
  id: number;
  amount: number;
  date: string;
  created_at?: string;
  effective_at?: string;
  description: string;
  type: "expense" | "income" | "savings_deposit" | "savings_withdrawal";
  income_type?: string;
  category: Category;
}

interface Props {
  tx: Transaction | null;
  onClose: () => void;
  /** Called after money moved between the budget and savings (parent refreshes). */
  onMoved?: () => void;
}

const TransactionDetailModal: React.FC<Props> = ({ tx, onClose, onMoved }) => {
  const { t } = useTranslation();
  const { axiosInstance } = useAuth();
  const { formatAmount, hasActiveCycle, cycleWindow, currentCycle, refreshCycle } = useSettings();
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");

  useEffect(() => { setMoveError(""); }, [tx]);

  // An expense of the current cycle can be re-filed as money moved to savings
  // (the server re-checks; this only decides whether to offer it).
  const canMoveToSavings =
    !!tx && tx.type === "expense" && hasActiveCycle && !!cycleWindow &&
    tx.category?.id !== currentCycle?.saved_money_category_id &&
    isInWindow(txEventTime(tx), {
      start: new Date(cycleWindow.start),
      end: cycleWindow.end ? new Date(cycleWindow.end) : null,
      source: "cycle",
    });

  // Any savings deposit can be moved back into the budget — the reverse of
  // the above (see ReturnToBudget; it explains itself when there is no cycle).
  const isDeposit = !!tx && tx.type === "savings_deposit";
  const afterMove = () => {
    onMoved?.();
    onClose();
  };

  const moveToSavings = async () => {
    if (!tx) return;
    setMoving(true);
    setMoveError("");
    try {
      await axiosInstance.post(`/transactions/${tx.id}/savings`);
      await refreshCycle();
      afterMove();
    } catch (err) {
      setMoveError(savingsMoveError(err, t, formatAmount) ?? t("transactions.move_to_savings_error"));
    } finally {
      setMoving(false);
    }
  };

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
  const isSavings = tx?.type === "savings_deposit" || tx?.type === "savings_withdrawal";
  // Same sign as the list: money into savings is "+", out of it "−".
  const isInflow = isIncome || tx?.type === "savings_deposit";

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
              <div className={`txd-amount ${isInflow ? "txd-amount--income" : "txd-amount--expense"}`}>
                {isInflow ? "+" : "−"}{formatAmount(tx.amount)}
              </div>
              <div className={`txd-type-pill ${isInflow ? "txd-type--income" : "txd-type--expense"}`}>
                {isSavings ? <PiggyBank size={13} /> : isIncome ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {isSavings
                  ? `${t("dashboard.saved_money")} · ${t(tx.type === "savings_deposit" ? "dashboard.savings_deposit" : "dashboard.savings_withdraw")}`
                  : isIncome ? t("transactions.type_income") : t("transactions.type_expense")}
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
                <span className="txd-value">{categoryLabel(tx.category, t, "—")}</span>
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

            {canMoveToSavings && (
              <div className="txd-move">
                <button
                  type="button"
                  className="txd-move-btn"
                  onClick={moveToSavings}
                  disabled={moving}
                  aria-label={t("transactions.move_to_savings_aria", { amount: formatAmount(tx.amount) })}
                >
                  <PiggyBank size={16} aria-hidden="true" />
                  {t("transactions.move_to_savings_btn")}
                </button>
                <p className="txd-move-hint">{t("transactions.move_to_savings_hint")}</p>
                {moveError && <p className="txd-move-error" role="alert">{moveError}</p>}
              </div>
            )}

            {isDeposit && (
              <div className="txd-move">
                <ReturnToBudget
                  depositId={tx.id}
                  depositAmount={tx.amount}
                  inputId={`txd-return-${tx.id}`}
                  onDone={afterMove}
                />
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default TransactionDetailModal;
