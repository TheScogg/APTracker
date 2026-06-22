export function createDropdownController({ dropdownId, buttonId, wrapId }) {
  const getDropdown = () => document.getElementById(dropdownId);
  const getButton = () => document.getElementById(buttonId);

  function setOpen(isOpen) {
    const dropdown = getDropdown();
    const button = getButton();
    dropdown?.classList.toggle('visible', isOpen);
    button?.classList.toggle('open', isOpen);
    button?.setAttribute('aria-expanded', String(isOpen));
  }

  function isOpen() {
    return getDropdown()?.classList.contains('visible') || false;
  }

  function toggle() {
    setOpen(!isOpen());
  }

  function close() {
    setOpen(false);
  }

  function bindOutsideClick() {
    if (!wrapId) return;
    document.addEventListener('click', event => {
      const wrap = document.getElementById(wrapId);
      if (wrap && !wrap.contains(event.target)) close();
    });
  }

  return {
    toggle,
    close,
    isOpen,
    bindOutsideClick
  };
}
