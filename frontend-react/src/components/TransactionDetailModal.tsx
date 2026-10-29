import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Tag, CalendarDays, Clock, AlignLeft, TrendingUp, TrendingDown, PiggyBank, ArrowLeftRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../context/SettingsContext";
import { categoryLabel } from "../utils/categoryLabel";
import { inCurrentCycle } from "../utils/categoryWindow";
import { txFlow, flowSign, flowClass, flowLabelKey, isBudgetRow, isSavingsToBudgetTransfer } from "../utils/transactionKind";
import ReturnToBudget from "./ReturnToBudget";
import MoveToSavings from "./MoveToSavings";
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
  type: "expense" | "income" | "savings_deposit" | "savings_withdrawal" | "budget_transfer";
  income_type?: string;
  source?: string;
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
  const { formatAmount, hasActiveCycle, cycleWindow, currentCycle } = useSettings();

  // A current-cycle expense or "Переменный бюджет" row can move into savings
  // (the server re-checks; this only decides whether to offer it).
  const canMoveToSavings =
    !!tx && hasActiveCycle && inCurrentCycle(tx, cycleWindow) &&
    (isBudgetRow(tx) || (tx.type === "expense" && tx.category?.id !== currentCycle?.saved_money_category_id));

  // Any savings deposit can be moved back into the budget — the reverse of
  // the above (see ReturnToBudget; it explains itself when there is no cycle).
  const isDeposit = !!tx && tx.type === "savings_deposit";
  const afterMove = () => {
    onMoved?.();
    onClose();
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
  // Same sign/colour/label as the list (utils/transactionKind).
  const flow = tx ? txFlow(tx) : "out";
  const isTransfer = flow === "transfer";
  const isSavings = !isTransfer && (tx?.type === "savings_deposit" || tx?.type === "savings_withdrawal");

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
              <div className={`txd-amount txd-amount--${flowClass(flow)}`}>
                {flowSign(flow).replace("-", "−")}{formatAmount(tx.amount)}
              </div>
              <div className={`txd-type-pill txd-type--${flowClass(flow)}`}>
                {isTransfer ? <ArrowLeftRight size={13} /> : isSavings ? <PiggyBank size={13} /> : isIncome ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {isSavings
                  ? `${t("dashboard.saved_money")} · ${t(tx.type === "savings_deposit" ? "dashboard.savings_deposit" : "dashboard.savings_withdraw")}`
                  : t(flowLabelKey(flow))}
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
                <span className="txd-value">
                  {isSavingsToBudgetTransfer(tx) ? t("transactions.transfer_savings_to_budget") : categoryLabel(tx.category, t, "—")}
                </span>
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
                <MoveToSavings
                  txId={tx.id}
                  amount={tx.amount}
                  kind={isBudgetRow(tx) ? "budgetRow" : "expense"}
                  onDone={afterMove}
                />
              </div>
            )}

            {isDeposit && (
              <div className="txd-move">
                <ReturnToBudget
                  depositId={tx.id}
                  depositAmount={tx.amount}
                  depositTime={tx}
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
