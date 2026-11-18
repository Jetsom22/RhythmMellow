// The stage build by default. ?classic=1 opens the validation build (rooms and the first boss).
if (new URLSearchParams(location.search).get('classic')) void import('./classic');
else void import('./stage');
