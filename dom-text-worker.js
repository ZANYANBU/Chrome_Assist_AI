self.onmessage = (event) => {
  const items = Array.isArray(event.data?.items) ? event.data.items : [];
  const lines = items.map((item) => {
    const tag = item?.tag || 'div';
    const type = item?.type ? (' type="' + item.type + '"') : '';
    const text = (
      item?.ariaLabel ||
      item?.testId ||
      item?.placeholder ||
      item?.labelText ||
      item?.title ||
      item?.alt ||
      item?.name ||
      item?.text ||
      item?.value ||
      ''
    ).toString().trim().substring(0, 60);
    return '<' + tag + type + '> "' + text + '"';
  });

  self.postMessage({ lines });
};
