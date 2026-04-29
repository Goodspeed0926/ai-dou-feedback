/**
 * AI豆新声 - 钉钉AI表格数据代理
 * Cloudflare Worker: 接收H5表单数据，写入钉钉AI表格
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 内存缓存 access token（Worker 实例生命周期内有效）
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const resp = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appKey: env.DINGTALK_APP_KEY,
      appSecret: env.DINGTALK_APP_SECRET,
    }),
  });

  const data = await resp.json();
  if (!data.accessToken) {
    throw new Error('获取access token失败: ' + JSON.stringify(data));
  }

  cachedToken = data.accessToken;
  tokenExpiry = now + (data.expireIn - 300) * 1000;
  return cachedToken;
}

function mapFormToFields(formData) {
  const fields = {};

  if (formData.name) fields['姓名'] = formData.name;
  if (formData.company) fields['公司/单位'] = formData.company;
  if (formData.title) fields['职位'] = formData.title;
  if (formData.phone) fields['手机号码'] = formData.phone;
  if (formData.wechat) fields['微信号'] = formData.wechat;
  if (formData.painpoint) fields['日常需要优化提效的工作'] = formData.painpoint;
  if (formData.other) fields['其他建议或需求'] = formData.other;

  if (formData.scale) fields['公司规模'] = formData.scale;
  if (formData.aiUsage) fields['当前AI工具使用情况'] = formData.aiUsage;
  if (formData.intent) fields['采购意向'] = formData.intent;
  if (formData.demo) fields['希望预约产品演示'] = formData.demo;

  if (formData.rating) fields['活动满意度'] = Number(formData.rating);

  if (formData.features && formData.features.length > 0) {
    fields['最感兴趣的功能'] = formData.features;
  }

  return fields;
}

async function createRecord(env, fields) {
  const token = await getAccessToken(env);

  const apiUrl = `https://api.dingtalk.com/v1.0/notable/bases/${env.BASE_ID}/sheets/${env.TABLE_ID}/records?operatorId=${env.OPERATOR_ID}`;

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': token,
    },
    body: JSON.stringify({
      records: [{ fields }],
    }),
  });

  const result = await resp.json();

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      cachedToken = null;
      tokenExpiry = 0;
      const newToken = await getAccessToken(env);
      const retryResp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': newToken,
        },
        body: JSON.stringify({
          records: [{ fields }],
        }),
      });
      const retryResult = await retryResp.json();
      if (!retryResp.ok) {
        throw new Error(`钉钉API错误(重试): ${JSON.stringify(retryResult)}`);
      }
      return retryResult;
    }
    throw new Error(`钉钉API错误: ${JSON.stringify(result)}`);
  }

  return result;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: '仅支持POST请求' }),
        { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const formData = await request.json();

      if (!formData.name || !formData.phone) {
        return new Response(
          JSON.stringify({ success: false, error: '姓名和手机号为必填项' }),
          { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
        );
      }

      const fields = mapFormToFields(formData);
      const result = await createRecord(env, fields);

      return new Response(
        JSON.stringify({
          success: true,
          recordId: result.value?.[0]?.id || null,
        }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Error:', error);
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }
  },
};
