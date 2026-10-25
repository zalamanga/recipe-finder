const target = new URL('index.html', location.href);
const category = new URLSearchParams(location.search).get('category');
if (category) target.search = new URLSearchParams({ category }).toString();
document.getElementById('destination').href = target.href;
location.replace(target);
