function sanitize(input) {
    return input ? input.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim() : '';
}
module.exports = sanitize;
