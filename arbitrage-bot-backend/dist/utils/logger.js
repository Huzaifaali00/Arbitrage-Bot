"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.splat(), winston_1.default.format.json(), winston_1.default.format.printf(({ timestamp, level, message, ...rest }) => {
        const sanitized = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
        const meta = Object.keys(sanitized).length ? JSON.stringify(sanitized) : '';
        return `${timestamp} [${level.toUpperCase()}]: ${message} ${meta}`;
    })),
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, ...rest }) => {
                const sanitized = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
                const meta = Object.keys(sanitized).length ? ` ${JSON.stringify(sanitized)}` : '';
                return `${timestamp} ${level}: ${message}${meta}`;
            })),
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join('logs', 'bot.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join('logs', 'error.log'),
            level: 'error',
            maxsize: 10485760,
            maxFiles: 5,
        }),
    ],
});
exports.default = logger;
//# sourceMappingURL=logger.js.map