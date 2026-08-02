// Helper de test (importat doar din suite, nu din cod de productie): raspuns ale
// carui headere sosesc imediat, dar al carui body picura la nesfarsit. Serveste
// la exersarea expirarilor din FAZA DE BODY, pe care bugetul le acopera la fel
// ca faza de fetch.
export function drippingStream(): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  return new ReadableStream({
    start(controller) {
      timer = setInterval(() => {
        // Dupa ce cititorul anuleaza, enqueue arunca. Fara garda, eroarea ajunge
        // unhandled DUPA terminarea testului si pica rularea intregii suite.
        try {
          controller.enqueue(new TextEncoder().encode("a"));
        } catch {
          stop();
        }
      }, 10);
      // Plasa de siguranta: testul nu are voie sa atarne daca semnalul nu ajunge.
      setTimeout(() => {
        stop();
        try {
          controller.close();
        } catch {
          // deja inchis
        }
      }, 5000).unref?.();
    },
    cancel() {
      stop();
    },
  });
}
