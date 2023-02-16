const sleep = time =>
  new Promise(resolve => {
    setTimeout(resolve, time);
  });

// 去头尾指定字符
const strip = (str, chars) => {
  let newStr = str;
  chars.forEach(char => {
    newStr = newStr.replace(new RegExp(`^${char}+|${char}+$`, 'g'), '');
  });
  return newStr;
};

module.exports = {
  sleep,
  strip,
};
