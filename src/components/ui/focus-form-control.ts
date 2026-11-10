/** El valor de un selector viaja en un hidden; el foco pertenece al combobox visible. */
export function focusFormControl(form: HTMLFormElement | null, name: string): boolean {
  const control = form?.elements.namedItem(name);
  if (!(control instanceof HTMLElement)) return false;
  const inputId = control.dataset.selectInputId;
  const target = inputId ? document.getElementById(inputId) : control;
  if (!target) return false;
  target.focus();
  return document.activeElement === target;
}
