export default {
  async scheduled(event, env, ctx) {
    const response = await fetch('https://zap.cooking/api/cron/check-expiring-memberships', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CRON_SECRET}`
      }
    });
    
    const result = await response.json();
    console.log('Cron job result:', result);
  }
};
