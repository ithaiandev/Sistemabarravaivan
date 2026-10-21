// Proteção da tela de carregamento: se o sistema não abrir em 10 segundos
// (internet lenta, navegador antigo ou arquivo antigo no cache), explica o que fazer.
// Escrito em JavaScript simples de propósito, para funcionar até em navegadores antigos.
(function () {
  setTimeout(function () {
    var boot = document.getElementById('boot');
    if (!boot || /(^|\s)hidden(\s|$)/.test(boot.className)) return;
    boot.innerHTML = '';
    var box = document.createElement('div');
    box.style.cssText = 'max-width:420px;padding:0 20px;text-align:center;line-height:1.6';
    box.innerHTML = '<p><b>O sistema está demorando para abrir.</b></p>' +
      '<p>1. Confira se a internet está funcionando.<br>' +
      '2. Recarregue a página (no computador: Ctrl+Shift+R).<br>' +
      '3. Se continuar, atualize o navegador ou abra no Google Chrome.</p>';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Recarregar';
    btn.addEventListener('click', function () { location.reload(); });
    box.appendChild(btn);
    boot.appendChild(box);
  }, 10000);
})();
