const WebSocket = require('ws');
const fs = require('fs');

const wsUrl = "ws://localhost:9222/devtools/page/AC9864AAE2DC3D76FB602DCD3B93818A";
const ws = new WebSocket(wsUrl);

let msgId = 1;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const payload = JSON.stringify({ id, method, params });
    pending.set(id, { resolve, reject });
    ws.send(payload);
  });
}

ws.on('open', async () => {
  try {
    console.log('Connected to Chrome DevTools port');
    await send('Page.enable');
    await send('Runtime.enable');
    
    // Ensure we are in demo mode
    console.log('Navigating to http://localhost:8788/index.html?demo=1 ...');
    await send('Page.navigate', { url: 'http://localhost:8788/index.html?demo=1' });
    
    // Wait for the app to bootstrap
    console.log('Waiting for app to bootstrap...');
    await new Promise(r => setTimeout(r, 4000));
    
    // Set device metrics
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    });

    // Check if #app is visible
    let evalAppVisible = await send('Runtime.evaluate', {
      expression: 'document.getElementById("app").classList.contains("visible")'
    });
    console.log('Is app visible initially?', evalAppVisible.result.value);

    // Let's click the user pill to open the user dropdown so #signout-btn is visible and clickable
    console.log('Opening user dropdown...');
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("user-pill-btn").click()'
    });
    await new Promise(r => setTimeout(r, 500));

    // Let's click sign out
    console.log('Clicking sign out...');
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("signout-btn").click()'
    });

    // Wait 3 seconds for Firebase signout and state updates
    await new Promise(r => setTimeout(r, 3000));

    // Verify if #login-screen is visible
    let evalLoginVisible = await send('Runtime.evaluate', {
      expression: 'document.getElementById("login-screen").classList.contains("visible")'
    });
    console.log('Is login screen visible after signout?', evalLoginVisible.result.value);

    let evalAppVisibleAfter = await send('Runtime.evaluate', {
      expression: 'document.getElementById("app").classList.contains("visible")'
    });
    console.log('Is app visible after signout?', evalAppVisibleAfter.result.value);

    // Capture screenshot of login screen
    console.log('Capturing login screen screenshot...');
    let result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/Users/chris/.gemini/antigravity-ide/brain/5b4a86cb-d166-4140-87e8-a0dd3ca3155b/demo_signed_out_screen.png', Buffer.from(result.data, 'base64'));
    console.log('Screenshot saved to demo_signed_out_screen.png');

    // Click "Open Demo Plant" button to log back in
    console.log('Clicking "Open Demo Plant" button...');
    await send('Runtime.evaluate', {
      expression: 'document.getElementById("demo-login-btn").click()'
    });

    // Wait 3 seconds for login to complete
    await new Promise(r => setTimeout(r, 3000));

    // Verify if app is visible again
    let evalAppVisibleRe = await send('Runtime.evaluate', {
      expression: 'document.getElementById("app").classList.contains("visible")'
    });
    console.log('Is app visible again after clicking Open Demo Plant?', evalAppVisibleRe.result.value);

    // Capture screenshot of logged back in
    console.log('Capturing logged back in screenshot...');
    result = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('/Users/chris/.gemini/antigravity-ide/brain/5b4a86cb-d166-4140-87e8-a0dd3ca3155b/demo_relogged_in_screen.png', Buffer.from(result.data, 'base64'));
    console.log('Screenshot saved to demo_relogged_in_screen.png');

    ws.close();
  } catch (e) {
    console.error('Automation error:', e);
    ws.close();
  }
});

ws.on('message', (data) => {
  const res = JSON.parse(data);
  if (res.id && pending.has(res.id)) {
    const { resolve, reject } = pending.get(res.id);
    pending.delete(res.id);
    if (res.error) {
      reject(res.error);
    } else {
      resolve(res.result);
    }
  }
});
