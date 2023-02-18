const { Configuration, OpenAIApi } = require('openai');
const Koa = require('koa');
const Router = require('koa-router');
const logger = require('koa-logger');
const bodyParser = require('koa-bodyparser');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const {
  init: initDB,
  Counter,
  Message,
  MESSAGE_STATUS_ANSWERED,
  MESSAGE_STATUS_THINKING,
  AI_TYPE_TEXT,
  AI_TYPE_IMAGE,
} = require('./db');

const { sleep, strip } = require('./utils');

const router = new Router();

const homePage = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

// 清空指令
const CLEAR_KEY = 'CLEAR_';
const CLEAR_KEY_TEXT = `${CLEAR_KEY}0`;
const CLEAR_KEY_IMAGE = `${CLEAR_KEY}1`;

const AI_IMAGE_KEY = '作画';

const AI_THINKING_MESSAGE = '我已经在编了，请稍等几秒后复制原文再说一遍~';

const LIMIT_AI_TEXT_COUNT = 10;
const LIMIT_AI_IMAGE_COUNT = 5;

const LIMIT_COUNT_RESPONSE = '对不起，因为ChatGPT调用收费，您的免费使用额度已用完~'

const configuration = new Configuration({
  apiKey: '##your api key##',
});

const openai = new OpenAIApi(configuration);

async function buildCtxPrompt({ FromUserName }) {
  // 获取最近对话
  const messages = await Message.findAll({
    where: {
      fromUser: FromUserName,
      aiType: AI_TYPE_TEXT,
    },
    limit: LIMIT_AI_TEXT_COUNT,
    order: [['updatedAt', 'ASC']],
  });
  // 只有一条的时候，就不用封装上下文了
  return messages.length === 1
    ? messages[0].request
    : messages
        .map(({ response, request }) => `Q: ${request}\n A: ${response}`)
        .join('\n');
}

async function getAIResponse(prompt) {
  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt,
    max_tokens: 1024,
    temperature: 0.1,
  });

  const response = (completion?.data?.choices?.[0].text || 'AI 挂了').trim();

  return strip(response, ['\n', 'A: ']);
}

async function getAIIMAGE(prompt) {
  const response = await openai.createImage({
    prompt: prompt,
    n: 1,
    size: '1024x1024',
  });

  const imageURL = response?.data?.data?.[0].url || 'AI 作画挂了';

  return imageURL;
}

// 获取 AI 回复消息
async function getAIMessage({ Content, FromUserName }) {
  // 找一下，是否已有记录
  const message = await Message.findOne({
    where: {
      fromUser: FromUserName,
      request: Content,
    },
  });

  // 已回答，直接返回消息
  if (message?.status === MESSAGE_STATUS_ANSWERED) {
    return `[GPT]: ${message?.response}`;
  }

  // 在回答中
  if (message?.status === MESSAGE_STATUS_THINKING) {
    return AI_THINKING_MESSAGE;
  }

  const aiType = Content.startsWith(AI_IMAGE_KEY)
    ? AI_TYPE_IMAGE
    : AI_TYPE_TEXT;

  // 检查一下历史消息记录，不能超过限制
  const count = await Message.count({
    where: {
      fromUser: FromUserName,
      aiType: aiType,
    },
  });

  // 超过限制，返回提示
  if (aiType === AI_TYPE_TEXT && count >= LIMIT_AI_TEXT_COUNT) {
    return LIMIT_COUNT_RESPONSE;
  }

  // 超过限制，返回提示
  if (aiType === AI_TYPE_IMAGE && count >= LIMIT_AI_IMAGE_COUNT) {
    return LIMIT_COUNT_RESPONSE;
  }

  // 没超过限制时，正常走AI链路
  // 因为AI响应比较慢，容易超时，先插入一条记录，维持状态，待后续更新记录。
  await Message.create({
    fromUser: FromUserName,
    response: '',
    request: Content,
    aiType,
  });

  let response = '';

  if (aiType === AI_TYPE_TEXT) {
    // 构建带上下文的 prompt
    const prompt = await buildCtxPrompt({ Content, FromUserName });

    // 请求远程消息
    response = await getAIResponse(prompt);
  }

  if (aiType === AI_TYPE_IMAGE) {
    // 去掉开始前的关键词
    const prompt = Content.substring(AI_IMAGE_KEY.length);
    // 请求远程消息
    response = await getAIIMAGE(prompt);
  }

  // 成功后，更新记录
  await Message.update(
    {
      response: response,
      status: MESSAGE_STATUS_ANSWERED,
    },
    {
      where: {
        fromUser: FromUserName,
        request: Content,
      },
    },
  );

  return `[GPT]: ${response}`;
}

// 消息推送
router.post('/message/post', async ctx => {
  const { ToUserName, FromUserName, Content, CreateTime } = ctx.request.body;

  if (!FromUserName) {
    ctx.body = {
      ToUserName: FromUserName,
      FromUserName: ToUserName,
      CreateTime: CreateTime,
      MsgType: 'text',
      Content: '无用户信息',
    };
    return;
  }

  if ((Content || '').trim() === '获取id') {
    ctx.body = {
      ToUserName: FromUserName,
      FromUserName: ToUserName,
      CreateTime: CreateTime,
      MsgType: 'text',
      Content: FromUserName,
    };
    return;
  }

  if ((Content || '').startsWith(CLEAR_KEY)) {
    const clearType = Content.startsWith(CLEAR_KEY_IMAGE)
      ? AI_TYPE_IMAGE
      : AI_TYPE_TEXT;
    const FromUserName = Content.substring(CLEAR_KEY_TEXT.length);
    const count = await Message.destroy({
      where: {
        fromUser: FromUserName,
        aiType: {
          [Op.or]: [clearType, null],
        },
      },
    });
    ctx.body = {
      ToUserName: FromUserName,
      FromUserName: ToUserName,
      CreateTime: CreateTime,
      MsgType: 'text',
      Content: `已重置用户共 ${count} 条消息`,
    };
    return;
  }

  const message = await Promise.race([
    // 3秒微信服务器就会超时，超过2.8秒要提示用户重试
    sleep(2800).then(() => AI_THINKING_MESSAGE),
    getAIMessage({ Content, FromUserName }),
  ]);

  ctx.body = {
    ToUserName: FromUserName,
    FromUserName: ToUserName,
    CreateTime: +new Date(),
    MsgType: 'text',
    Content: message,
  };
});

// 首页
router.get('/', async ctx => {
  ctx.body = homePage;
});

// 更新计数
router.post('/api/count', async ctx => {
  const { request } = ctx;
  const { action } = request.body;
  if (action === 'inc') {
    await Counter.create();
  } else if (action === 'clear') {
    await Counter.destroy({
      truncate: true,
    });
  }

  ctx.body = {
    code: 0,
    data: (await Counter.count()) + 10,
  };
});

// 获取计数
router.get('/api/count', async ctx => {
  const result = await Counter.count();

  ctx.body = {
    code: 0,
    data: result,
  };
});

// 小程序调用，获取微信 Open ID
router.get('/api/wx_openid', async ctx => {
  if (ctx.request.headers['x-wx-source']) {
    ctx.body = ctx.request.headers['x-wx-openid'];
  }
});

const app = new Koa();
app
  .use(logger())
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods());

const port = process.env.PORT || 80;
async function bootstrap() {
  await initDB();

  app.listen(port, () => {
    console.log('启动成功', port);
  });
}
bootstrap();
