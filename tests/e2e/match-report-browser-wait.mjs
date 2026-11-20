export async function waitForReportBrowser(evaluate, expression) {
  for (let attempt = 0; attempt < 450; attempt++) {
    try {
      // Page.navigate can finish while the new document is still parsing its head.
      if (await evaluate(`Promise.resolve(document.body && (${expression})).then(Boolean)`)) return;
    } catch (error) {
      if (!/context|navigat/i.test(String(error))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error("OFFLINE_EXPECTATION " + expression);
}
