'use strict';

const { matchesFamily } = require('./duka-family');

/**
 * Shared pairing handlers for the S6W and smart fan drivers. Each driver
 * passes its family so the search lists matching units plus units that did
 * not report a model. A known mismatch or an unsupported model is rejected.
 */
function createPairHandlers(driver, session, family) {
  const app = driver.homey.app;

  session.setHandler('search', async () => {
    const found = await app.duka.search(5000);
    return found.filter((device) => matchesFamily(device.family, family));
  });

  session.setHandler('add', async (data) => {
    const deviceId = String((data && data.deviceId) || '')
      .trim()
      .toUpperCase();
    if (!deviceId) throw new Error(driver.homey.__('pair.errors.device_id'));

    const password = String((data && data.password) || '').trim() || '1111';
    const address = String((data && data.address) || '').trim() || null;

    const info = await app.duka.probe({
      id: deviceId,
      password,
      address,
    });

    if (info.family === 'unsupported') {
      throw new Error(driver.homey.__('pair.errors.unsupported_model'));
    }
    if (info.family !== null && info.family !== family) {
      throw new Error(
        driver.homey.__(
          family === 's6w' ? 'pair.errors.wrong_model_s6w' : 'pair.errors.wrong_model_smart',
        ),
      );
    }

    return {
      id: deviceId,
      password,
      address: info.address || address || '',
      family,
      manualSpeed: info.manualSpeed !== null,
      firmware: info.firmwareVersion || null,
      unitType: info.unitType === null ? null : info.unitType,
    };
  });
}

module.exports = { createPairHandlers };
