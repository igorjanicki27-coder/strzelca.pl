const { handleApi } = require('./_shooting-range');

module.exports = async (req, res) => {
  try {
    await handleApi(req, res);
  } catch (error) {
    console.error('shooting-range api:', error);
    const status = Number(error?.status || 500);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        success: false,
        error: error?.message || 'Wystąpił błąd modułu strzelnicy.',
      }),
    );
  }
};
