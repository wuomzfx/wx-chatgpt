const { Sequelize, DataTypes } = require('sequelize');

// 从环境变量中读取数据库配置
const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS = '' } = process.env;

const [host, port] = MYSQL_ADDRESS.split(':');

const sequelize = new Sequelize('nodejs_demo', MYSQL_USERNAME, MYSQL_PASSWORD, {
  host,
  port,
  dialect: 'mysql' /* one of 'mysql' | 'mariadb' | 'postgres' | 'mssql' */,
});

// 定义数据模型
const Counter = sequelize.define('Counter', {
  count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
});

// AI 思考中；
const MESSAGE_STATUS_THINKING = 'THINKING';
// AI 已回答；
const MESSAGE_STATUS_ANSWERED = 'ANSWERED';

// 文本，比如 chatGPT；
const AI_TYPE_TEXT = 'TEXT';

// 图片，比如 DALL.E；
const AI_TYPE_IMAGE = 'IMAGE';

const Message = sequelize.define('Message', {
  fromUser: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  request: {
    type: DataTypes.STRING(2048),
    allowNull: false,
  },
  response: {
    type: DataTypes.STRING(2048),
    allowNull: true,
    defaultValue: null,
  },
  status: {
    type: DataTypes.ENUM(MESSAGE_STATUS_THINKING, MESSAGE_STATUS_ANSWERED),
    allowNull: false,
    defaultValue: MESSAGE_STATUS_THINKING,
  },
  aiType: {
    type: DataTypes.ENUM(AI_TYPE_TEXT, AI_TYPE_IMAGE),
    allowNull: false,
    defaultValue: AI_TYPE_TEXT,
  },
});

// 数据库初始化方法
async function init() {
  await Counter.sync({ alter: true });
  await Message.sync({ alter: true });
}

// 导出初始化方法和模型
module.exports = {
  init,
  Counter,
  Message,
  MESSAGE_STATUS_THINKING,
  MESSAGE_STATUS_ANSWERED,
  AI_TYPE_TEXT,
  AI_TYPE_IMAGE,
};
