async function shouldThrow(promise, message) {
    try {
        await promise;
        assert(true);
    }
    catch (err) {
        return;
    }
    assert(false, message);
}

async function bnCloseTo(v1, v2, delta) {
    const diff = (v1.sub(v2)).abs()
    assert(diff.lt(delta), `${v1.toString()} is not close to ${v2.toString()}`);
}

module.exports = {
    shouldThrow,
    bnCloseTo,
};