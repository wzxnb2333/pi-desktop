const $ = id => document.getElementById(id);
function status() { chrome.runtime.sendMessage({ type: 'pi-status' }, value => { $('state').textContent = value?.connected ? `Connected · ${value.port}` : 'Not connected'; }); }
$('connect').onclick = () => {
  $('connect').disabled = true; $('state').textContent = 'Connecting…';
  chrome.runtime.sendMessage({ type: 'pi-connect', code: $('code').value.trim(), port: $('port').value.trim() }, value => {
    $('state').textContent = chrome.runtime.lastError?.message || value?.error || 'Connected'; $('connect').disabled = false;
  });
};
$('disconnect').onclick = () => chrome.runtime.sendMessage({ type: 'pi-disconnect' }, () => { $('state').textContent = 'Not connected'; });
status();
