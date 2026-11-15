/**
 * @param {{
 *   events: Array<any>;
 *   notificationsEnabled: boolean;
 *   playAudio: (sounds: Array<string>) => Promise<any>;
 *   sendNotification: (event: any) => Promise<any>;
 * }} options
 */
export async function dispatchAlertChannels({
  events,
  notificationsEnabled,
  playAudio,
  sendNotification,
}) {
  let audioError = null;
  const audible = events.filter((event) => event.sound !== "none");
  if (audible.length) {
    try {
      await playAudio(audible.map((event) => event.sound));
    } catch (error) {
      audioError = error instanceof Error ? error : new Error(String(error || "聲音播放失敗"));
    }
  }

  if (notificationsEnabled) {
    const notifiable = events.filter((event) => event.notificationEnabled !== false);
    for (const event of notifiable) await sendNotification(event);
  }

  return { audioError, audibleCount: audible.length };
}
