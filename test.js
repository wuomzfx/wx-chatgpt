const { Configuration, OpenAIApi } = require('openai');
const Koa = require('koa');
const Router = require('koa-router');
const logger = require('koa-logger');
const bodyParser = require('koa-bodyparser');
const { strip } = require('./utils');

const { init: initDB, db, Message, MESSAGE_STATUS_ANSWERED, MESSAGE_STATUS_THINKING, AI_TYPE_TEXT, AI_TYPE_IMAGE } = require('./db');

const router = new Router();

const homePage = `
  <html>
    <head>
      <title>ChatGPT 微信机器人</title>
    </head>
    <body>
      <h1>ChatGPT 微信机器人</h1>
      <p>ChatGPT 是一个基于 OpenAI GPT 模型的聊天机器人，可以根据用户的问题生成智能回答。</p>
    </body>
  </html>
`;

// 清空指令
const CLEAR_KEY = 'CLEAR_';
const CLEAR_KEY_TEXT = `${CLEAR_KEY}0`;
const CLEAR_KEY_IMAGE = `${CLEAR_KEY}1`;

const AI_IMAGE_KEY = '作画';

const AI_THINKING_MESSAGE = '我已经在编了，请稍等几秒后复制原文再说一遍~';

const LIMIT_AI_TEXT_COUNT = 10;
const LIMIT_AI_IMAGE_COUNT = 5;

const LIMIT_COUNT_RESPONSE = '对不起，因为 ChatGPT 调用收费，您的免费使用额度已用完~'

const configuration = new Configuration({
  apiKey: '##your api key##',
});

const openai = new OpenAIApi(configuration);

async function buildCtxPrompt(fromUser) {
  // 获取最近对话
  const messages = await db.query(
    `SELECT * FROM Messages WHERE fromUser = :fromUser AND aiType = :aiType ORDER BY updatedAt ASC LIMIT :limit`,
    {
      type: db.QueryTypes.SELECT,
      replacements: {
        fromUser,
        aiType: AI_TYPE_TEXT,
        limit: LIMIT_AI_TEXT_COUNT,
      },
    }
  );
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

// 处理文本消息
async function handleTextMessage(message) {
  const { Content, FromUserName } = message;
  const aiType = Content.startsWith(AI_IMAGE_KEY) 
    ? AI_TYPE_IMAGE
    : AI_TYPE_TEXT;
    
    // 找一下，是否已有记录
    const [existingMessage] = await Message.findOrCreate({
    where: {
    fromUser: FromUserName,
    request: Content,
    },
    defaults: {
    fromUser: FromUserName,
    response: '',
    request: Content,
    aiType,
    status: MESSAGE_STATUS_THINKING,
    },
    });
    
    // 已回答，直接返回消息
    if (existingMessage.status === MESSAGE_STATUS_ANSWERED) {
    return `[GPT]: ${existingMessage.response}`;
    }
    
    // 在回答中
    if (existingMessage.status === MESSAGE_STATUS_THINKING) {
    return AI_THINKING_MESSAGE;
    }
    
    // 检查一下历史消息记录，不能超过限制
    const count = await Message.count({
    where: {
    fromUser: FromUserName,
    aiType,
    },
    });
 
    // 超过限制，返回提示
    if (aiType === AI_TYPE_IMAGE && count >= LIMIT_AI_IMAGE_COUNT) {
    return LIMIT_COUNT_RESPONSE;
    }
    
    // 没超过限制时，正常走 AI 链路
    // 因为 AI 响应比较慢，容易超时，先插入一条记录，维持状态，待后续更新记录。
    existingMessage.update({
    status: MESSAGE_STATUS_THINKING,
    });
    
    // 构建带上下文的 prompt
    const prompt = await buildCtxPrompt(FromUserName);
    
    // 请求远程消息
    let response = '';
    if (aiType === AI_TYPE_TEXT) {
    response = await getAIResponse(prompt + Content);
    }
    if (aiType === AI_TYPE_IMAGE) {
    // 去掉开始前的关键词
    const prompt = Content.substring(AI_IMAGE_KEY.length);
    // 请求远程消息
    response = await getAIIMAGE(prompt);
    }
    
    // 成功后，更新记录
    existingMessage.update({
    response,
    status: MESSAGE_STATUS_ANSWERED,
    });
    
    return `[GPT]: ${response}`;
    }

    const robot = new WeRoBot({
        token: '123456',
        });
        
        robot.use(logger());
        robot.use(bodyParser());
        
        // 消息处理
        robot.on('text', async (ctx) => {
        const { message } = ctx.request.body;
        ctx.reply(await handleTextMessage(message));
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
        
        // 404 处理
        app.use(async (ctx, next) => {
        await next();
        if (ctx.status === 404) {
        ctx.body = '404 - 页面不存在';
        }
        });
        
        app.use(router.routes()).use(router.allowedMethods());
        
        async function bootstrap() {
        await initDB();
        
        const port = process.env.PORT || 80;
        app.listen(port, () => {
        console.log('启动成功', port);
        });
        }
        
        bootstrap();
        
        console.log('程序启动');
