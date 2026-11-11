import { describe, expect, it } from "vitest";
import { MAX_TOASTS, pushToast, removeToast, TOAST_DURATION, type ToastItem } from "./toast-queue";

const item = (
  id: number,
  text = `aviso ${id}`,
  tone: ToastItem["tone"] = "success",
): ToastItem => ({
  id,
  tone,
  text,
});

describe("fila de toasts", () => {
  it("acrescenta no fim", () => {
    const list = pushToast([item(1)], item(2));
    expect(list.map((t) => t.id)).toEqual([1, 2]);
  });

  it("mesmo texto e tom renova o aviso no lugar, sem duplicar", () => {
    const list = pushToast([item(1, "Salvo."), item(2)], item(3, "Salvo."));
    expect(list.map((t) => t.id)).toEqual([3, 2]);
  });

  it("mesmo texto com outro tom é outro aviso", () => {
    const list = pushToast([item(1, "Conta")], item(2, "Conta", "error"));
    expect(list).toHaveLength(2);
  });

  it("passou do limite, o mais antigo sai", () => {
    let list: ToastItem[] = [];
    for (let id = 1; id <= MAX_TOASTS + 2; id++) list = pushToast(list, item(id));
    expect(list).toHaveLength(MAX_TOASTS);
    expect(list[0]?.id).toBe(3);
  });

  it("remove pelo id e ignora id desconhecido", () => {
    const list = [item(1), item(2)];
    expect(removeToast(list, 1).map((t) => t.id)).toEqual([2]);
    expect(removeToast(list, 9)).toEqual(list);
  });

  it("erro fica mais tempo que sucesso", () => {
    expect(TOAST_DURATION.error).toBeGreaterThan(TOAST_DURATION.success);
  });
});
