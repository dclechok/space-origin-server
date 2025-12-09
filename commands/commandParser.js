const moveCommand = require("./moveCommand");

const commands = {
    n: moveCommand,
    north: moveCommand,
    s: moveCommand,
    south: moveCommand,
    e: moveCommand,
    east: moveCommand,
    w: moveCommand,
    west: moveCommand,
};

module.exports = function commandParser(command) {
    const com = command.trim().toLowerCase();
    const [cmd, ...args] = com.split(" ");

    const handler = commands[cmd];

    if (!handler) {
        return { error: `Directive unknown. Awaiting valid input...` };
    }
    
    return { handler, args, cmd };
};
