let domainsFuc = () => {
  let domain, uri = location.host;
  if (process.env.NODE_ENV === 'development' || (!uri.includes('www.gsess.cn'))) {
    domain = 'https://t.i31.com/sun/elevator/crm';

    domain = 'https://test.i31.com/wisdom/elevator/crm';
  } else {
    domain = 'http://www.gsess.cn/sun/elevator/crm';
  }
  // domain = 'http://192.168.1.63:8085/jlkj/sun/elevator/crm';  
  domain = 'https://test.i31.com/wisdom/elevator/crm';
  return {
    domain: domain,
  }
};
export default domainsFuc   
